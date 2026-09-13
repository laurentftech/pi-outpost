/**
 * The reference validator's registry, rules and batch checks, as a reviewer runs them.
 *
 * A specification is exported from a requirements tool and checked away from this
 * application, so every check here runs the bundle copied to a directory with no path
 * back to this repository and nothing but Node. The bundle is rebuilt first, always: a
 * stale one would test last week's validator.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { before, describe, test } from "node:test";
import { tableMarkdown } from "@pi-outpost/shared/structured-exchange/table-export";
import type { StructuredTableData } from "@pi-outpost/shared/structured-exchange";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const BUNDLE = path.join(REPO, "shared/dist/validate-structured-exchange.mjs");
const away = mkdtempSync(path.join(tmpdir(), "structured-exchange-rules-cli-"));
const cli = path.join(away, "validate-structured-exchange.mjs");

type Outcome = { code: number; stdout: string };

function run(args: string[]): Outcome {
  try {
    const stdout = execFileSync(process.execPath, [cli, ...args], {
      cwd: away,
      input: "",
      encoding: "utf8",
      env: { PATH: process.env.PATH ?? "" },
      maxBuffer: 64 * 1024 * 1024,
    });
    return { code: 0, stdout };
  } catch (error) {
    const failure = error as { status: number; stdout: string; stderr: string };
    assert.equal(failure.stderr, "", `the CLI wrote to stderr: ${failure.stderr}`);
    return { code: failure.status, stdout: failure.stdout };
  }
}

type Verdict = {
  valid: boolean;
  subject?: string;
  issues?: { rule: string; path: string; message: string; file?: string }[];
  files?: { path: string; sha256: string }[];
  profile?: { id?: string; applied: boolean; findings?: { ruleId: string; outcome: string }[] };
  counts?: Record<string, number>;
  perRule?: Record<string, number>;
  unreadable?: { line: number; reason: string }[];
  report?: string;
  reportMarkdown?: string;
};
const verdictOf = (outcome: Outcome) => JSON.parse(outcome.stdout) as Verdict;

const profile = {
  schema: "urn:structured-exchange-profile:1",
  id: "acme/requirements",
  label: "ACME requirements",
  elementKinds: [
    {
      kind: "requirement",
      attributes: [
        { name: "category", type: "enumeration", values: ["derived", "refined", "direct"], closed: true },
        { name: "safety", type: "enumeration", values: ["yes", "no"], closed: true },
        { name: "verification", type: "enumeration", values: ["analysis", "review", "test"], closed: true },
      ],
    },
  ],
  relationshipKinds: [{ kind: "satisfies" }],
};

const rules = {
  schema: "urn:structured-exchange-rules:1",
  profile: "acme/requirements",
  rules: [
    {
      id: "ARP4754A-derived-no-satisfy",
      source: "ARP4754A",
      statement: "Une exigence dérivée ne satisfait pas une exigence amont.",
      level: "refuse",
      relationship: "satisfies",
      when: { from: { category: ["derived"] } },
      then: "forbidden",
    },
    {
      id: "SAF-satisfied-by-safety",
      source: "Safety plan §4",
      statement: "Une exigence safety n'est satisfaite que par des exigences safety.",
      level: "refuse",
      relationship: "satisfies",
      when: { to: { safety: ["yes"] } },
      then: { from: { safety: ["yes"] } },
    },
    {
      id: "CAT-derived-verification",
      source: "Verification plan",
      statement: "Une exigence dérivée se vérifie par analyse ou revue.",
      level: "report",
      element: "requirement",
      when: { category: ["derived"] },
      then: { verification: ["analysis", "review"] },
    },
  ],
};

/** A project directory holding a registry, its profile and its rules file. */
function project(name: string, rulesFile: unknown = rules): string {
  const root = path.join(away, name);
  mkdirSync(path.join(root, ".pi-outpost"), { recursive: true });
  mkdirSync(path.join(root, "profiles"), { recursive: true });
  mkdirSync(path.join(root, "rules"), { recursive: true });
  writeFileSync(path.join(root, "profiles/requirements.json"), JSON.stringify(profile, null, 2));
  writeFileSync(path.join(root, "rules/review.json"), JSON.stringify(rulesFile, null, 2));
  writeFileSync(
    path.join(root, ".pi-outpost/structured-exchange.json"),
    JSON.stringify({
      schema: "urn:structured-exchange-profile-registry:1",
      profiles: ["profiles/requirements.json"],
      rules: ["rules/review.json"],
      default: "acme/requirements",
    }),
  );
  return path.join(root, ".pi-outpost/structured-exchange.json");
}

type Row = { id: string; text: string; attributes: Record<string, unknown> };
/** A table document: its rows, and `satisfies` relations between them by identifier or reference. */
function table(rows: Row[], relations: { from: Record<string, string>; to: Record<string, string> }[] = []) {
  return {
    schema: "urn:structured-exchange:2",
    kind: "table",
    profile: "acme/requirements",
    data: {
      columns: ["id", "requirement"],
      rows: rows.map((row) => ({ id: row.id, ref: row.id.toUpperCase(), kind: "requirement", cells: [row.id.toUpperCase(), row.text], attributes: row.attributes })),
      ...(relations.length === 0 ? {} : { relations: relations.map((relation) => ({ ...relation, kind: "satisfies" })) }),
    },
  };
}
const line = (subject: string, document: unknown) => JSON.stringify({ subjects: [subject], document });

const upstream: Row = { id: "sys-1", text: "Stop within 40 m", attributes: { category: "direct", safety: "yes" } };

const write = (name: string, value: unknown) => {
  const file = path.join(away, name);
  writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value, null, 2));
  return file;
};

describe("the reference validator's registry and rules checks, as they ship", () => {
  before(() => {
    execFileSync(process.execPath, [path.join(REPO, "shared/scripts/build-validator.mjs")], { cwd: REPO, stdio: "ignore" });
    copyFileSync(BUNDLE, cli);
  });

  test("a usable registry is accepted with the digests of the files it read", () => {
    const outcome = run(["--registry", project("usable")]);
    assert.equal(outcome.code, 0, outcome.stdout);
    const verdict = verdictOf(outcome);
    assert.equal(verdict.subject, "registry");
    assert.deepEqual(
      verdict.files?.map((file) => file.path),
      ["profiles/requirements.json", "rules/review.json"],
    );
    for (const file of verdict.files ?? []) assert.match(file.sha256, /^sha256:[0-9a-f]{64}$/);
  });

  test("a rules file naming a value its profile does not list makes the registry unusable, named with its file, rule and pointer", () => {
    // ARulesFileIsCheckedAgainstItsProfile
    const misspelt = structuredClone(rules);
    misspelt.rules[0].when = { from: { category: ["dérivée"] } };
    const registry = project("misspelt", misspelt);
    const outcome = run(["--registry", registry]);
    assert.equal(outcome.code, 4, outcome.stdout);
    const verdict = verdictOf(outcome);
    assert.equal(verdict.subject, "registry");
    const issue = verdict.issues?.[0];
    assert.equal(issue?.file, "rules/review.json");
    assert.equal(issue?.rule, "rules-format/undeclared-value");
    assert.equal(issue?.path, "/rules/0/when/from/category/0");

    // The same status holding a document to it: an unusable registry is not a stray document.
    const document = run(["--registry", registry, write("any.json", table([upstream]))]);
    assert.equal(document.code, 4);
  });

  test("a missing registry is unusable, not an unconstrained project", () => {
    const outcome = run(["--registry", path.join(away, "nowhere/.pi-outpost/structured-exchange.json")]);
    assert.equal(outcome.code, 4);
    assert.equal(verdictOf(outcome).issues?.[0].rule, "registry/unreadable");
  });

  test("a document violating a refuse rule is refused with the rule's identifier, statement and pointer", () => {
    // ADocumentIsValidatedAgainstARegistry
    const registry = project("document");
    const derived = table(
      [{ id: "req-2", text: "Brake pressure", attributes: { category: "derived", safety: "yes", verification: "test" } }, upstream],
      [{ from: { id: "req-2" }, to: { id: "sys-1" } }],
    );
    const outcome = run(["--registry", registry, write("derived.json", derived)]);
    assert.equal(outcome.code, 1, outcome.stdout);
    const issues = verdictOf(outcome).issues ?? [];
    const refusal = issues.find((issue) => issue.rule === "rule/ARP4754A-derived-no-satisfy");
    assert.ok(refusal, JSON.stringify(issues));
    assert.equal(refusal.path, "/data/relations/0");
    assert.match(refusal.message, /Une exigence dérivée ne satisfait pas une exigence amont\./);
  });

  test("a document with only findings to check passes against the registry, and carries them", () => {
    const registry = project("findings");
    const toCheck = table([{ id: "req-4", text: "Pressure sensor", attributes: { category: "derived", safety: "no", verification: "test" } }]);
    const outcome = run(["--registry", registry, write("to-check.json", toCheck)]);
    assert.equal(outcome.code, 0, outcome.stdout);
    const verdict = verdictOf(outcome);
    assert.equal(verdict.profile?.applied, true);
    assert.deepEqual(
      verdict.profile?.findings?.map((finding) => `${finding.ruleId} ${finding.outcome}`),
      ["CAT-derived-verification violated"],
    );
  });

  test("the registry's rules are listed, each statement beside the conditions it checks", () => {
    // RulesAreListedBesideTheirStatements
    const outcome = run(["--registry", project("listing"), "--describe-profile"]);
    assert.equal(outcome.code, 0, outcome.stdout);
    const listing = outcome.stdout;
    assert.match(listing, /^Profile acme\/requirements — ACME requirements/);
    assert.match(listing, /Rules for acme\/requirements: 3/);
    const block = (id: string) => {
      const start = listing.indexOf(`  ${id} — `);
      assert.notEqual(start, -1, `${id} is not listed`);
      const next = listing.indexOf("\n\n", start);
      return listing.slice(start, next === -1 ? undefined : next);
    };
    assert.equal(
      block("ARP4754A-derived-no-satisfy"),
      [
        "  ARP4754A-derived-no-satisfy — refuse — ARP4754A",
        "    Une exigence dérivée ne satisfait pas une exigence amont.",
        "    applies to: relationship satisfies",
        '    when: source category ∈ {"derived"}',
        "    then: forbidden",
      ].join("\n"),
    );
    assert.equal(
      block("SAF-satisfied-by-safety"),
      [
        "  SAF-satisfied-by-safety — refuse — Safety plan §4",
        "    Une exigence safety n'est satisfaite que par des exigences safety.",
        "    applies to: relationship satisfies",
        '    when: target safety ∈ {"yes"}',
        '    then: source safety ∈ {"yes"}',
      ].join("\n"),
    );
    assert.equal(
      block("CAT-derived-verification").trimEnd(),
      [
        "  CAT-derived-verification — report — Verification plan",
        "    Une exigence dérivée se vérifie par analyse ou revue.",
        "    applies to: element requirement",
        '    when: category ∈ {"derived"}',
        '    then: verification ∈ {"analysis", "review"}',
      ].join("\n"),
    );

    const unknown = run(["--registry", project("listing"), "--describe-profile", "acme/tests"]);
    assert.equal(unknown.code, 2);
  });
});

describe("a specification validated requirement by requirement, as it ships", () => {
  before(() => {
    execFileSync(process.execPath, [path.join(REPO, "shared/scripts/build-validator.mjs")], { cwd: REPO, stdio: "ignore" });
    copyFileSync(BUNDLE, cli);
  });

  const conforming = line("req-1", table([{ id: "req-1", text: "Stop within 40 m", attributes: { category: "direct", safety: "yes" } }]));
  const toCheck = line("req-4", table([{ id: "req-4", text: "Pressure sensor", attributes: { category: "derived", safety: "no", verification: "test" } }]));
  const nonConforming = line(
    "req-2",
    table(
      [{ id: "req-2", text: "Brake pressure", attributes: { category: "derived", safety: "yes", verification: "analysis" } }, upstream],
      [{ from: { id: "req-2" }, to: { id: "sys-1" } }],
    ),
  );

  test("findings to check do not fail the run, and both reports are written", () => {
    // FindingsToCheckDoNotFailTheRun
    const registry = project("batch-to-check");
    const batch = write("to-check.jsonl", [JSON.stringify({ heading: "1. Braking", depth: 1 }), conforming, toCheck].join("\n"));
    const report = path.join(away, "to-check-report.json");
    const markdown = path.join(away, "to-check-report.md");
    const outcome = run(["--registry", registry, "--batch", batch, "--report", report, "--report-markdown", markdown]);
    assert.equal(outcome.code, 0, outcome.stdout);
    const verdict = verdictOf(outcome);
    assert.deepEqual(verdict.counts, { conforms: 1, "non-conforming": 0, "to check": 1 });
    assert.deepEqual(verdict.perRule, { "CAT-derived-verification": 1 });

    // The report is a table the same interface accepts, bound to the files it was checked against.
    const written = JSON.parse(readFileSync(report, "utf8"));
    assert.equal(run([report]).code, 0);
    assert.deepEqual(
      written.artifacts.map((artifact: { rel: string; uri: string }) => `${artifact.rel} ${artifact.uri}`),
      ["checkedAgainst profiles/requirements.json", "checkedAgainst rules/review.json"],
    );
    // Summary lines are plain cell arrays: a label, then its value.
    const summary = (written.data.rows as unknown[]).find((row): row is unknown[] => Array.isArray(row) && row[0] === "validator");
    assert.match(String(summary?.[1]), /^validate-structured-exchange \d+\.\d+\.\d+/);
    assert.match(readFileSync(markdown, "utf8"), /^# Conformity report\n/);
  });

  test("a non-conforming requirement fails the run", () => {
    // ANonConformingRequirementFailsTheRun
    const registry = project("batch-non-conforming");
    const outcome = run(["--registry", registry, "--batch", write("non-conforming.jsonl", [conforming, nonConforming].join("\n"))]);
    assert.equal(outcome.code, 1, outcome.stdout);
    const verdict = verdictOf(outcome);
    assert.equal(verdict.valid, false);
    assert.equal(verdict.counts?.["non-conforming"], 1);
  });

  test("an unreadable line fails the run and is named, and an unreadable batch or a batch without a registry is refused", () => {
    const registry = project("batch-unreadable");
    const outcome = run(["--registry", registry, "--batch", write("unreadable.jsonl", [conforming, "{ nope", toCheck].join("\n"))]);
    assert.equal(outcome.code, 1, outcome.stdout);
    assert.deepEqual(verdictOf(outcome).unreadable?.map((entry) => entry.line), [2]);

    assert.equal(run(["--registry", registry, "--batch", path.join(away, "no-such.jsonl")]).code, 2);
    assert.equal(run(["--batch", write("alone.jsonl", conforming)]).code, 2);
    assert.equal(run(["--registry", registry, "--report", path.join(away, "r.json")]).code, 2);
  });

  test("a ten-thousand-line batch is validated in one invocation", (t) => {
    // ALargeBatchRunsInOneProcess
    const registry = project("batch-large");
    const lines: string[] = [];
    for (let index = 0; index < 10_000; index += 1) {
      if (index % 100 === 0) lines.push(JSON.stringify({ heading: `Chapter ${index / 100 + 1}`, depth: 1 }));
      const id = `req-${index}`;
      lines.push(
        line(
          id,
          table(
            [{ id, text: `Requirement ${index}`, attributes: { category: index % 50 === 0 ? "derived" : "refined", safety: "yes", verification: "analysis" } }, upstream],
            [{ from: { id }, to: { id: "sys-1" } }],
          ),
        ),
      );
    }
    const markdown = path.join(away, "large-report.md");
    const started = performance.now();
    const outcome = run(["--registry", registry, "--batch", write("large.jsonl", lines.join("\n")), "--report-markdown", markdown]);
    const seconds = (performance.now() - started) / 1000;
    t.diagnostic(`10,000 requirements validated in ${seconds.toFixed(1)} s`);
    const verdict = verdictOf(outcome);
    assert.deepEqual(verdict.unreadable, []);
    assert.deepEqual(verdict.counts, { conforms: 9_800, "non-conforming": 200, "to check": 0 });
    assert.equal(outcome.code, 1);
    const written = readFileSync(markdown, "utf8");
    assert.match(written, /\| requirements \| 10000 \|/);
    assert.ok(written.includes("| REQ-9999 | Requirement 9999 | conforms |"), "the last requirement is in the Markdown report");
  });
});

describe("a table exported as Markdown by the validator", () => {
  before(() => {
    execFileSync(process.execPath, [path.join(REPO, "shared/scripts/build-validator.mjs")], { cwd: REPO, stdio: "ignore" });
    copyFileSync(BUNDLE, cli);
  });

  test("writes the Markdown the reader's export writes for the same rows", () => {
    // MarkdownExportRunsWithoutABrowser
    const data = {
      columns: ["id", "requirement"],
      rows: [
        { heading: "1. Braking", depth: 1 },
        { id: "r1", role: "added", cells: ["REQ-1", "Stop | within\n40 m"] },
        { id: "r2", role: "context", cells: ["REQ-2", "Warn the driver"] },
        { heading: "1.1 Sensors", depth: 2 },
        { id: "r3", cells: ["REQ-3", null] },
      ],
    };
    const outcome = run(["--markdown", write("roles.json", { schema: "urn:structured-exchange:2", kind: "table", data })]);
    assert.equal(outcome.code, 0, outcome.stdout);
    assert.equal(outcome.stdout, tableMarkdown(data as unknown as StructuredTableData));
    assert.match(outcome.stdout, /^## 1\. Braking$/m);
    assert.match(outcome.stdout, /\| change \|/);
  });

  test("refuses a graph, which has no Markdown export", () => {
    const graph = { schema: "urn:structured-exchange:2", kind: "graph", data: { nodes: [{ id: "a", label: "A" }], edges: [] } };
    const outcome = run(["--markdown", write("graph.json", graph)]);
    assert.equal(outcome.code, 1, outcome.stdout);
    assert.equal(verdictOf(outcome).issues?.[0].rule, "markdown/not-a-table");
  });
});

describe("the documented batch example, as it ships", () => {
  before(() => {
    execFileSync(process.execPath, [path.join(REPO, "shared/scripts/build-validator.mjs")], { cwd: REPO, stdio: "ignore" });
    copyFileSync(BUNDLE, cli);
  });

  test("runs through the bundle against the documented registry, profile and rules, with the exit status the page states", () => {
    const docs = readFileSync(path.join(REPO, "docs/structured-exchange.md"), "utf8");
    const blocks = [...docs.matchAll(/```json\r?\n([\s\S]*?)```/g)].flatMap((match) => {
      try {
        return [JSON.parse(match[1]) as Record<string, unknown>];
      } catch {
        return [];
      }
    });
    const bySchema = (schema: string) => blocks.filter((block) => block.schema === schema);
    const [documentedRegistry] = bySchema("urn:structured-exchange-profile-registry:1") as { profiles: string[]; rules: string[]; default: string }[];
    assert.ok(documentedRegistry, "the page shows a registry");
    const documentedProfile = bySchema("urn:structured-exchange-profile:1").find((block) => block.id === documentedRegistry.default);
    const documentedRules = bySchema("urn:structured-exchange-rules:1");
    assert.ok(documentedProfile, "the page shows the registry's default profile");
    assert.equal(documentedRegistry.profiles.length, 1);
    assert.equal(documentedRegistry.rules.length, documentedRules.length);

    const root = path.join(away, "documented");
    const place = (relative: string, value: unknown) => {
      mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
      writeFileSync(path.join(root, relative), JSON.stringify(value, null, 2));
    };
    place(documentedRegistry.profiles[0], documentedProfile);
    documentedRegistry.rules.forEach((relative, index) => place(relative, documentedRules[index]));
    place(".pi-outpost/structured-exchange.json", documentedRegistry);

    const section = docs.slice(docs.indexOf("### Validating a whole specification"));
    const batch = /```jsonl\r?\n([\s\S]*?)```/.exec(section)?.[1];
    assert.ok(batch, "the page shows a batch");
    assert.equal(batch.trim().split(/\r?\n/).length, 2, "the documented batch is two lines");
    const stated = /It exits \*\*(\d)\*\*/.exec(section);
    assert.ok(stated, "the page states the batch's exit status");

    const outcome = run(["--registry", path.join(root, ".pi-outpost/structured-exchange.json"), "--batch", write("documented.jsonl", batch)]);
    assert.equal(outcome.code, Number(stated[1]), outcome.stdout);
    const verdict = verdictOf(outcome);
    assert.deepEqual(verdict.unreadable, []);
    assert.deepEqual(verdict.counts, { conforms: 1, "non-conforming": 1, "to check": 0 });
    assert.deepEqual(verdict.perRule, { "ARP4754A-derived-no-satisfy": 1 });
  });
});

describe("a conformity report held to the registry it was checked against, as it ships", () => {
  before(() => {
    execFileSync(process.execPath, [path.join(REPO, "shared/scripts/build-validator.mjs")], { cwd: REPO, stdio: "ignore" });
    copyFileSync(BUNDLE, cli);
  });

  test("passes, never held to the project's default profile", () => {
    // AReportIsNeverHeldToAProjectsProfile, through the check the agent's tools share
    const registry = project("report-under-default");
    const report = path.join(away, "report-under-default.json");
    const batch = write("report-under-default.jsonl", line("req-1", table([{ id: "req-1", text: "Stop within 40 m", attributes: { category: "direct", safety: "yes" } }])));
    assert.equal(run(["--registry", registry, "--batch", batch, "--report", report]).code, 0);

    const outcome = run(["--registry", registry, report]);
    assert.equal(outcome.code, 0, outcome.stdout);
    assert.deepEqual(verdictOf(outcome).profile, { applied: false });
  });
});
