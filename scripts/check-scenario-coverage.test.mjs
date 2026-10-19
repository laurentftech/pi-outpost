/**
 * The gate is only worth having if it fails on the things it claims to catch. Each
 * test builds a small change on disk and runs the real script against it.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "check-scenario-coverage.mjs");
const roots = [];

/** A throwaway repository with one change in it. */
function fixture({ specs, matrix, tasks = "- [x] done" }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "scenario-gate-"));
  roots.push(root);
  const change = path.join(root, "openspec", "changes", "a-change");
  for (const [capability, body] of Object.entries(specs)) {
    const dir = path.join(change, "specs", capability);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "spec.md"), body);
  }
  fs.writeFileSync(path.join(change, "tasks.md"), `${tasks}\n`);
  if (matrix !== undefined) fs.writeFileSync(path.join(change, "scenario-coverage.md"), matrix);
  return root;
}

/** The script's verdict: `{ code, output }`, both streams together. */
function run(root, args = ["--all"]) {
  try {
    const output = execFileSync(process.execPath, [SCRIPT, ...args], {
      env: { ...process.env, PI_OUTPOST_SCENARIO_ROOT: root },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, output };
  } catch (error) {
    return { code: error.status ?? 1, output: `${error.stdout ?? ""}${error.stderr ?? ""}` };
  }
}

const oneScenario = "## ADDED Requirements\n\n### Requirement: A\nThe system SHALL do a thing.\n\n#### Scenario: It does the thing\n- **WHEN** asked\n- **THEN** it does\n";

after(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

describe("check-scenario-coverage", () => {
  test("ignores a change only the base has, when the base shares no history with the branch", () => {
    // CI fetches main one commit deep: no merge base, so the script falls back to a plain
    // diff, which also lists what main gained since the branch started. A change merged
    // there meanwhile was reported as "no such change" and failed every open PR.
    const root = fixture({
      specs: { alpha: oneScenario },
      matrix: "| Scenario | Coverage | Evidence |\n|---|---|---|\n| It does the thing | covered | `scripts/check-scenario-coverage.mjs` — the checker itself, cited because it exists |\n",
    });
    fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(root, "scripts", "check-scenario-coverage.mjs"), "// fixture\n");
    const git = (...args) => execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "-c", "commit.gpgsign=false", ...args], { cwd: root, stdio: "pipe" });
    git("init", "-q", "-b", "branch");
    git("add", "-A");
    git("commit", "-qm", "the branch");
    git("checkout", "-q", "--orphan", "base");
    git("rm", "-rq", "--cached", ".");
    fs.mkdirSync(path.join(root, "openspec", "changes", "merged-there"), { recursive: true });
    // Content of its own: identical files would read as a rename, hiding the deletion.
    fs.writeFileSync(path.join(root, "openspec", "changes", "merged-there", "tasks.md"), "- [x] merged on the base meanwhile\n");
    git("add", "openspec/changes/merged-there");
    git("commit", "-qm", "the base, unrelated");
    git("checkout", "-q", "-f", "branch");
    fs.rmSync(path.join(root, "openspec", "changes", "merged-there"), { recursive: true, force: true });
    const { code, output } = run(root, ["--base", "base"]);
    assert.doesNotMatch(output, /merged-there/);
    assert.match(output, /a-change: 1 scenario\(s\), all covered/);
    assert.equal(code, 0, output);
  });

  test("accepts a change whose every scenario is covered with a real citation", () => {
    const root = fixture({
      specs: { alpha: oneScenario },
      matrix: "| Scenario | Coverage | Evidence |\n|---|---|---|\n| It does the thing | covered | `scripts/check-scenario-coverage.mjs` — the checker itself, cited because it exists |\n",
    });
    fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(root, "scripts", "check-scenario-coverage.mjs"), "// fixture\n");
    const { code } = run(root);
    assert.equal(code, 0);
  });

  test("refuses a change with no matrix at all", () => {
    const { code, output } = run(fixture({ specs: { alpha: oneScenario } }));
    assert.equal(code, 1);
    assert.match(output, /no scenario-coverage\.md/);
  });

  test("refuses a scenario the matrix never mentions", () => {
    const { code, output } = run(
      fixture({
        specs: { alpha: `${oneScenario}\n#### Scenario: It also does another thing\n- **WHEN** asked twice\n- **THEN** it does\n` },
        matrix: "| Scenario | Coverage | Evidence |\n|---|---|---|\n| It does the thing | covered | `package.json` — a file that exists |\n",
      }),
    );
    assert.equal(code, 1);
    assert.match(output, /"It also does another thing".*is missing/s);
  });

  test("refuses a row that is not `covered`", () => {
    const { code, output } = run(
      fixture({
        specs: { alpha: oneScenario },
        matrix: "| Scenario | Coverage | Evidence |\n|---|---|---|\n| It does the thing | partial | `package.json` — half a test |\n",
      }),
    );
    assert.equal(code, 1);
    assert.match(output, /recorded as `partial`/);
  });

  test("accepts a `partial` row when incompleteness is allowed", () => {
    const root = fixture({
      specs: { alpha: oneScenario },
      matrix: "| Scenario | Coverage | Evidence |\n|---|---|---|\n| It does the thing | partial | `package.json` — half a test |\n",
    });
    fs.writeFileSync(path.join(root, "package.json"), "{}\n");
    assert.equal(run(root, ["--all", "--allow-incomplete"]).code, 0);
  });

  test("refuses a citation naming a file that is nowhere in the tree", () => {
    const { code, output } = run(
      fixture({
        specs: { alpha: oneScenario },
        matrix: "| Scenario | Coverage | Evidence |\n|---|---|---|\n| It does the thing | covered | `server/test/renamed-away.test.mjs` — gone |\n",
      }),
    );
    assert.equal(code, 1);
    assert.match(output, /renamed-away\.test\.mjs.*nowhere in the repository/);
  });

  test("refuses a matrix that cites nothing at all", () => {
    const { code, output } = run(
      fixture({
        specs: { alpha: oneScenario },
        matrix: "| Scenario | Coverage | Evidence |\n|---|---|---|\n| It does the thing | covered | it is tested, trust me |\n",
      }),
    );
    assert.equal(code, 1);
    assert.match(output, /cites no test file at all/);
  });

  test("refuses one unqualified row standing in for two capabilities", () => {
    const root = fixture({
      specs: { alpha: oneScenario, beta: oneScenario },
      matrix: "| Scenario | Coverage | Evidence |\n|---|---|---|\n| It does the thing | covered | `package.json` — one test for two capabilities |\n",
    });
    fs.writeFileSync(path.join(root, "package.json"), "{}\n");
    const { code, output } = run(root);
    assert.equal(code, 1);
    assert.match(output, /declared by more than one capability/);
  });

  test("accepts the same two capabilities once each row names its own", () => {
    const root = fixture({
      specs: { alpha: oneScenario, beta: oneScenario },
      matrix:
        "| Scenario | Coverage | Evidence |\n|---|---|---|\n" +
        "| `alpha / It does the thing` | covered | `package.json` — alpha's test |\n" +
        "| `beta / It does the thing` | covered | `package.json` — beta's test |\n",
    });
    fs.writeFileSync(path.join(root, "package.json"), "{}\n");
    assert.equal(run(root).code, 0);
  });

  test("reads citations under a fenced block rather than swallowing the table", () => {
    const root = fixture({
      specs: { alpha: oneScenario },
      matrix:
        "Enumerated with:\n\n```sh\nrg '^#### Scenario:' openspec/\n```\n\n" +
        "| Scenario | Coverage | Evidence |\n|---|---|---|\n| It does the thing | covered | `server/test/renamed-away.test.mjs` — gone |\n",
    });
    const { code, output } = run(root);
    assert.equal(code, 1);
    assert.match(output, /renamed-away\.test\.mjs.*nowhere in the repository/);
  });

  test("skips a change nobody has started", () => {
    const { code, output } = run(fixture({ specs: { alpha: oneScenario }, tasks: "- [ ] not yet" }));
    assert.equal(code, 0);
    assert.match(output, /skipped \(not started\)/);
  });
});
