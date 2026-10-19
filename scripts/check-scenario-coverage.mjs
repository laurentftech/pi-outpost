#!/usr/bin/env node
/**
 * Every scenario an OpenSpec change declares must be accounted for in that change's
 * `scenario-coverage.md`, and every citation in it must point at a file that exists.
 *
 * The house rule is that a feature is not done until each `#### Scenario:` is matched
 * to a test whose assertions would fail if the contract broke. A green suite cannot
 * show that, and neither can a coverage percentage: a change can carry three scenarios
 * nobody ever wrote a test for while every badge stays green. This is the mechanical
 * half of the rule — it proves the matrix exists, covers every scenario, and cites
 * real files. Whether the cited assertions are worth anything is still a reading job.
 *
 * Usage:
 *   node scripts/check-scenario-coverage.mjs                 # changes touched since origin/main
 *   node scripts/check-scenario-coverage.mjs --base <ref>    # ...since another ref
 *   node scripts/check-scenario-coverage.mjs --all           # every started change
 *   node scripts/check-scenario-coverage.mjs --change <name> # one change, by directory name
 *   node scripts/check-scenario-coverage.mjs --allow-incomplete   # `partial`/`uncovered` rows do not fail
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The repository this speaks about. Overridable so the checker can be run against a
// fixture tree in its own tests.
const ROOT = process.env.PI_OUTPOST_SCENARIO_ROOT
  ? path.resolve(process.env.PI_OUTPOST_SCENARIO_ROOT)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHANGES_DIR = path.join(ROOT, "openspec", "changes");
const MATRIX_NAME = "scenario-coverage.md";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
};

const allowIncomplete = flag("--allow-incomplete");
const base = value("--base") ?? "origin/main";

/** A change directory that exists and is not the archive. */
function activeChanges() {
  if (!fs.existsSync(CHANGES_DIR)) return [];
  return fs
    .readdirSync(CHANGES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== "archive")
    .map((entry) => entry.name)
    .sort();
}

/** Delta spec files of one change, at any capability depth. */
function deltaSpecs(change) {
  const specsRoot = path.join(CHANGES_DIR, change, "specs");
  if (!fs.existsSync(specsRoot)) return [];
  const found = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".md")) found.push(full);
    }
  };
  walk(specsRoot);
  return found.sort();
}

/**
 * A change nobody has started yet has nothing to prove: its tasks are all open, so
 * demanding a matrix would only teach people to write one before the code exists.
 */
function isStarted(change) {
  const tasks = path.join(CHANGES_DIR, change, "tasks.md");
  if (!fs.existsSync(tasks)) return true;
  return /^\s*-\s*\[x\]/im.test(fs.readFileSync(tasks, "utf8"));
}

/** Changes with files modified against the base ref — what this branch is actually proposing. */
function changesTouchedSince(ref) {
  let output;
  try {
    output = execFileSync("git", ["diff", "--name-only", `${ref}...HEAD`], { cwd: ROOT, encoding: "utf8" });
  } catch {
    try {
      output = execFileSync("git", ["diff", "--name-only", ref], { cwd: ROOT, encoding: "utf8" });
    } catch {
      return undefined; // no such ref (a shallow CI clone, a fresh repo) — the caller falls back
    }
  }
  const names = new Set();
  for (const line of output.split("\n")) {
    const match = line.match(/^openspec\/changes\/([^/]+)\//);
    // Only changes this tree has. Without a merge base — CI fetches the base one commit
    // deep — the fallback diff also lists what the base gained since the branch started,
    // and a change merged there in the meantime was reported here as "no such change".
    if (match && match[1] !== "archive" && fs.existsSync(path.join(CHANGES_DIR, match[1]))) names.add(match[1]);
  }
  return [...names].sort();
}

/** Comparable form of a scenario title: quotes, dashes and spacing vary between documents. */
function normalize(text) {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/[.:;,]+$/, "")
    .trim()
    .toLowerCase();
}

/**
 * A matrix may name a row `capability / ScenarioName`, in backticks, to disambiguate
 * two capabilities that share a scenario title. Both forms are read: the qualified
 * one binds to exactly one capability, the bare one only when the title is unique
 * within the change.
 */
function rowKeys(text) {
  const bare = text.replace(/`/g, "").trim();
  const slash = bare.lastIndexOf("/");
  if (slash === -1) return { qualified: undefined, title: normalize(bare) };
  return {
    qualified: `${normalize(bare.slice(0, slash))}/${normalize(bare.slice(slash + 1))}`,
    title: normalize(bare.slice(slash + 1)),
  };
}

function scenariosOf(file) {
  const found = [];
  const lines = fs.readFileSync(file, "utf8").split("\n");
  for (const line of lines) {
    const match = line.match(/^####\s+Scenario:\s*(.+?)\s*$/);
    if (match) found.push(match[1]);
  }
  return found;
}

/** Rows of the `| Scenario | Coverage | Assertion evidence |` table, however many tables there are. */
function matrixRows(file) {
  const rows = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) continue;
    const cells = trimmed.replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
    if (cells.length < 3) continue;
    if (/^-{2,}$/.test(cells[0].replace(/[\s:]/g, ""))) continue; // separator
    if (normalize(cells[0]) === "scenario") continue; // header
    rows.push({ scenario: cells[0], coverage: cells[1], evidence: cells.slice(2).join(" | ") });
  }
  return rows;
}

/**
 * Tracked files, by full path and by basename. A matrix cites `server/test/x.test.mjs`
 * in one row and plain `x.test.mjs` in the next; both are fine, and both stop being
 * fine the moment the file is renamed, which is the rot worth catching.
 */
const tracked = (() => {
  const paths = new Set();
  const basenames = new Set();
  try {
    // Tracked, plus what is merely present: a change under review routinely cites a
    // test file that is new and not yet committed.
    for (const argv of [["ls-files"], ["ls-files", "--others", "--exclude-standard"]]) {
      const output = execFileSync("git", argv, { cwd: ROOT, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
      for (const line of output.split("\n")) {
        const file = line.trim();
        if (!file) continue;
        paths.add(file);
        basenames.add(path.basename(file));
      }
    }
  } catch {
    // Not a git checkout: fall back to on-disk lookups only.
  }
  return { paths, basenames };
})();

function fileExists(cited) {
  const candidates = [cited];
  // Spec citations are routinely written relative to the openspec root.
  if (cited.startsWith("specs/") || cited.startsWith("changes/")) candidates.push(path.join("openspec", cited));
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(ROOT, candidate))) return true;
    if (tracked.paths.has(candidate)) return true;
  }
  if (!cited.includes("/")) return tracked.basenames.has(cited);
  return false;
}

/** Paths cited in an evidence cell, in backticks, that look like files. */
function citedFiles(evidence) {
  const cited = [];
  // No newlines inside the span: a fenced block would otherwise swallow the table
  // below it and the matrix would look as if it cited nothing.
  for (const match of evidence.matchAll(/`([^`\n]+)`/g)) {
    const candidate = match[1].trim();
    if (/^[\w./@-]+\.(ts|tsx|mjs|cjs|js|jsx|md|json)$/.test(candidate)) cited.push(candidate);
  }
  return cited;
}

function checkChange(change) {
  const problems = [];
  const specs = deltaSpecs(change);
  if (specs.length === 0) return { change, skipped: "no delta specs", problems };
  if (!isStarted(change)) return { change, skipped: "not started", problems };

  const specsRoot = path.join(CHANGES_DIR, change, "specs");
  const declared = [];
  for (const spec of specs) {
    // `specs/<capability-path>/spec.md` — the capability is what disambiguates two
    // deltas that happen to name a scenario the same way.
    const capability = normalize(path.dirname(path.relative(specsRoot, spec)));
    for (const scenario of scenariosOf(spec)) {
      declared.push({ scenario, capability, spec: path.relative(ROOT, spec) });
    }
  }
  if (declared.length === 0) return { change, skipped: "no scenarios declared", problems };

  const matrixPath = path.join(CHANGES_DIR, change, MATRIX_NAME);
  if (!fs.existsSync(matrixPath)) {
    problems.push(
      `no ${MATRIX_NAME}: ${declared.length} scenario(s) are declared and none is matched to a test`,
    );
    return { change, declared: declared.length, problems };
  }

  const rows = matrixRows(matrixPath).map((row) => ({ ...row, keys: rowKeys(row.scenario) }));

  // A bare title can only address one scenario. When two capabilities declare the
  // same title, one row would otherwise mark both covered on the strength of a
  // single test — so those rows have to name their capability.
  const titleCount = new Map();
  for (const { scenario } of declared) {
    const key = normalize(scenario);
    titleCount.set(key, (titleCount.get(key) ?? 0) + 1);
  }

  const claimedBy = new Map();
  for (const { scenario, capability, spec } of declared) {
    const title = normalize(scenario);
    const qualified = `${capability}/${title}`;
    let row = rows.find((candidate) => candidate.keys.qualified === qualified && !claimedBy.has(candidate));
    if (!row) {
      const bare = rows.filter((candidate) => candidate.keys.qualified === undefined && candidate.keys.title === title);
      // A matrix may repeat a title across its sections — main spec scenarios beside
      // the delta's, say — and that is fine: each declared scenario takes a row of
      // its own. What is not fine is two capabilities sharing a title with fewer
      // rows than scenarios, where one test would silently cover both.
      if (titleCount.get(title) > 1 && bare.length < titleCount.get(title)) {
        problems.push(
          `"${scenario}" is declared by more than one capability (${spec} among them) and ${MATRIX_NAME} does not name each one — write \`<capability> / ${scenario}\` per capability`,
        );
        continue;
      }
      row = bare.find((candidate) => !claimedBy.has(candidate));
    }
    if (!row) {
      problems.push(`"${scenario}" (${spec}) is missing from ${MATRIX_NAME}`);
      continue;
    }
    const already = claimedBy.get(row);
    if (already) {
      problems.push(`one row ("${row.scenario}") is standing in for both "${already}" and "${scenario}" — give each its own row`);
      continue;
    }
    claimedBy.set(row, scenario);

    const coverage = normalize(row.coverage);
    if (coverage !== "covered" && !allowIncomplete) {
      problems.push(`"${scenario}" is recorded as \`${row.coverage || "(empty)"}\`, not \`covered\``);
      continue;
    }
    if (row.evidence.trim() === "") {
      problems.push(`"${scenario}" is marked covered with an empty evidence cell`);
    }
  }

  // Citations rot: a test file gets renamed and the matrix keeps pointing at the old
  // name, which reads as proof and is not. Every path the matrix names must exist —
  // wherever in the table it appears, since a row may lean on the one above it.
  const matrixText = fs.readFileSync(matrixPath, "utf8");
  const cited = citedFiles(matrixText);
  if (cited.length === 0) {
    // Prose alone reads as proof and is not: a matrix has to point at the tests it
    // is claiming, somewhere, or there is nothing here a reviewer can go and check.
    problems.push(`${MATRIX_NAME} cites no test file at all — name the files its evidence rests on`);
  }
  const seen = new Set();
  for (const file of cited) {
    if (seen.has(file)) continue;
    seen.add(file);
    if (!fileExists(file)) {
      problems.push(`cites \`${file}\`, which is nowhere in the repository`);
    }
  }

  return { change, declared: declared.length, rows: rows.length, problems };
}

const only = value("--change");
let targets;
if (only) {
  targets = [only];
} else if (flag("--all")) {
  targets = activeChanges();
} else {
  const touched = changesTouchedSince(base);
  if (touched === undefined) {
    console.log(`[scenario-coverage] "${base}" is unknown here — checking every started change instead`);
    targets = activeChanges();
  } else {
    targets = touched;
  }
}

if (targets.length === 0) {
  console.log("[scenario-coverage] no change to check");
  process.exit(0);
}

let failed = false;
for (const change of targets) {
  if (!fs.existsSync(path.join(CHANGES_DIR, change))) {
    console.error(`[scenario-coverage] ✗ ${change}: no such change`);
    failed = true;
    continue;
  }
  const result = checkChange(change);
  if (result.skipped) {
    console.log(`[scenario-coverage] – ${change}: skipped (${result.skipped})`);
    continue;
  }
  if (result.problems.length === 0) {
    console.log(`[scenario-coverage] ✓ ${change}: ${result.declared} scenario(s), all covered with existing citations`);
    continue;
  }
  failed = true;
  console.error(`[scenario-coverage] ✗ ${change}:`);
  for (const problem of result.problems) console.error(`    ${problem}`);
}

if (failed) {
  console.error("");
  console.error("A scenario is covered when a test's assertions would fail if its contract broke.");
  console.error(`Record each one in openspec/changes/<change>/${MATRIX_NAME}, citing the test file and test name.`);
  process.exit(1);
}
