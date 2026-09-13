/**
 * A specification checked requirement by requirement, and the report a reviewer reads.
 *
 * Batches here are built the way an exporter would write them — one requirement per
 * document with its links and the requirements they reach — and the report is read back
 * as a structured-exchange table and as Markdown, so the assertions are on what a
 * reviewer would actually see.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { STRUCTURED_EXCHANGE_CEILINGS } from "@pi-outpost/shared/structured-exchange";
import type { ProfileRule, StructuredExchangeProfile } from "@pi-outpost/shared/structured-exchange/profile";
import { buildConformityReport, readBatch } from "@pi-outpost/shared/structured-exchange/conformity-report";
import { parseStructuredExchange } from "@pi-outpost/shared/structured-exchange/parse";
import { checkStructuredExchangeSchema } from "@pi-outpost/shared/structured-exchange/schema-node";

const profile: StructuredExchangeProfile = {
  schema: "urn:structured-exchange-profile:1",
  id: "acme/requirements",
  label: "ACME requirements",
  elementKinds: [
    {
      kind: "requirement",
      attributes: [
        { name: "category", type: "enumeration", values: ["derived", "refined", "direct"], closed: true },
        { name: "safety", type: "enumeration", values: ["yes", "no"], closed: true },
      ],
    },
  ],
  relationshipKinds: [{ kind: "satisfies" }],
};

const rules: ProfileRule[] = [
  { id: "ARP-derived", statement: "A derived requirement does not satisfy an upstream one.", level: "refuse", relationship: "satisfies", when: { from: { category: ["derived"] } }, then: "forbidden" },
  { id: "SAF-by-safety", statement: "A safety requirement is satisfied only by safety requirements.", level: "report", relationship: "satisfies", when: { to: { safety: ["yes"] } }, then: { from: { safety: ["yes"] } } },
];

const context = { profiles: new Map([[profile.id, profile]]), default: profile.id, rules: new Map([[profile.id, rules]]) };
const options = { date: "2026-09-13", version: "0.24.0-test", checkedAgainst: [{ uri: "profiles/requirements.json", sha256: `sha256:${"a".repeat(64)}` }] };

type Row = { id: string; text: string; attributes?: Record<string, unknown> };
/** One document line: its subject, its links and the rows they reach. */
function line(subject: string, rows: Row[], relations: { from: Record<string, string>; to: Record<string, string> }[] = []): string {
  return JSON.stringify({
    subjects: [subject],
    document: {
      schema: "urn:structured-exchange:2",
      kind: "table",
      profile: "acme/requirements",
      data: {
        columns: ["id", "requirement"],
        rows: rows.map((row) => ({ id: row.id, kind: "requirement", ref: row.id.toUpperCase(), cells: [row.id.toUpperCase(), row.text], ...(row.attributes ? { attributes: row.attributes } : {}) })),
        ...(relations.length === 0 ? {} : { relations: relations.map((relation) => ({ ...relation, kind: "satisfies" })) }),
      },
    },
  });
}

/** The report's requirement rows, as `id conformity`, skipping the summary and headings. */
function verdicts(table: Record<string, unknown>): string[] {
  const rows = (table.data as { rows: Record<string, unknown>[] }).rows;
  return rows.filter((row) => typeof row.id === "string").map((row) => `${row.id} ${(row.cells as unknown[]).at(-2)}`);
}

const batch = [
  JSON.stringify({ heading: "1. Braking", depth: 1 }),
  line("req-1", [{ id: "req-1", text: "Stop within 40 m", attributes: { category: "direct", safety: "yes" } }]),
  // Derived and satisfying req-1: refused by ARP-derived.
  line(
    "req-2",
    [
      { id: "req-2", text: "Brake pressure", attributes: { category: "derived", safety: "yes" } },
      { id: "req-1", text: "Stop within 40 m", attributes: { category: "direct", safety: "yes" } },
    ],
    [{ from: { id: "req-2" }, to: { id: "req-1" } }],
  ),
  // Satisfies something outside its document: not verifiable.
  line("req-3", [{ id: "req-3", text: "Warn the driver", attributes: { category: "direct", safety: "no" } }], [{ from: { id: "req-3" }, to: { ref: "SYS-9" } }]),
].join("\n");

describe("a batch", () => {
  test("each requirement is checked with its neighbours, which are not reported on", () => {
    // EachRequirementIsCheckedWithItsNeighbours
    const report = buildConformityReport(readBatch(batch), context, options);
    assert.ok(report.table, report.tableRefused);
    assert.deepEqual(verdicts(report.table), ["req-1 conforms", "req-2 non-conforming", "req-3 to check"]);
  });

  test("an unreadable line is named and the rest of the batch is still checked", () => {
    // AnUnreadableLineDoesNotStopTheBatch
    const lines = batch.split("\n");
    lines.splice(2, 0, "{ not json");
    const report = buildConformityReport(readBatch(lines.join("\n")), context, options);
    assert.deepEqual(report.unreadable.map((item) => item.line), [3]);
    assert.ok(report.table);
    assert.deepEqual(verdicts(report.table), ["req-1 conforms", "req-2 non-conforming", "req-3 to check"]);
  });

  test("a line held to no registered profile, or with other columns, is unreadable", () => {
    const foreign = JSON.stringify({ document: { schema: "urn:structured-exchange:2", kind: "table", profile: "acme/other", data: { columns: ["id", "requirement"], rows: [["X", "y"]] } } });
    const otherColumns = JSON.stringify({ document: { schema: "urn:structured-exchange:2", kind: "table", profile: "acme/requirements", data: { columns: ["ref"], rows: [{ id: "req-9", kind: "requirement", cells: ["R9"] }] } } });
    const report = buildConformityReport(readBatch([batch, foreign, otherColumns].join("\n")), context, options);
    assert.deepEqual(report.unreadable.map((item) => item.line), [5, 6]);
    assert.match(report.unreadable[1].reason, /columns/);
  });
});

describe("the conformity report", () => {
  test("keeps the specification's shape: summary, then its headings with their requirements beneath", () => {
    // TheReportKeepsTheSpecificationsShape
    const report = buildConformityReport(readBatch(batch), context, options);
    assert.ok(report.table);
    const rows = (report.table.data as { rows: Record<string, unknown>[] }).rows;
    const shape = rows.map((row) => (typeof row.heading === "string" ? `# ${row.heading}` : typeof row.id === "string" ? row.id : "summary line"));
    assert.equal(shape[0], "# Summary");
    const braking = shape.indexOf("# 1. Braking");
    assert.ok(braking > 0 && shape.slice(1, braking).every((item) => item === "summary line"));
    assert.deepEqual(shape.slice(braking), ["# 1. Braking", "req-1", "req-2", "req-3"]);
  });

  test("each requirement carries its verdict, and a violation names the rule and statement", () => {
    // EachRequirementCarriesItsVerdict
    const report = buildConformityReport(readBatch(batch), context, options);
    assert.ok(report.table);
    const rows = (report.table.data as { columns: string[]; rows: Record<string, unknown>[] });
    assert.deepEqual(rows.columns, ["id", "requirement", "conformity", "violations"]);
    const req2 = rows.rows.find((row) => row.id === "req-2") as { cells: string[]; ref: string; kind: string };
    assert.equal(req2.ref, "REQ-2");
    assert.equal(req2.kind, "requirement");
    assert.match(req2.cells[3], /ARP-derived: A derived requirement does not satisfy an upstream one\. \(→ req-1\)/);
    const req3 = rows.rows.find((row) => row.id === "req-3") as { cells: string[] };
    assert.match(req3.cells[3], /not verifiable here, → SYS-9/);
  });

  test("a link violation between two subjects shows on both rows and counts once", () => {
    // ALinkViolationShowsOnBothRowsAndCountsOnce
    const both = [
      line("req-a", [{ id: "req-a", text: "A", attributes: { category: "derived" } }, { id: "req-b", text: "B", attributes: { category: "direct" } }], [{ from: { id: "req-a" }, to: { id: "req-b" } }]),
      line("req-b", [{ id: "req-b", text: "B", attributes: { category: "direct" } }, { id: "req-a", text: "A", attributes: { category: "derived" } }], [{ from: { id: "req-a" }, to: { id: "req-b" } }]),
    ].join("\n");
    const report = buildConformityReport(readBatch(both), context, options);
    assert.ok(report.table);
    const rows = (report.table.data as { rows: Record<string, unknown>[] }).rows.filter((row) => typeof row.id === "string") as { id: string; cells: string[] }[];
    assert.match(rows[0].cells[3], /ARP-derived.*→ req-b/);
    assert.match(rows[1].cells[3], /ARP-derived.*← req-a/);
    assert.equal(report.perRule["ARP-derived"], 1);
  });

  test("records what it was checked against, the date and the version", () => {
    // TheReportRecordsWhatItWasCheckedAgainst
    const report = buildConformityReport(readBatch(batch), context, options);
    assert.ok(report.table);
    assert.deepEqual(report.table.artifacts, [{ rel: "checkedAgainst", uri: "profiles/requirements.json", sha256: `sha256:${"a".repeat(64)}` }]);
    const summary = (report.table.data as { rows: unknown[] }).rows.filter(Array.isArray) as unknown[][];
    assert.ok(summary.some((row) => row[0] === "checked on" && row[1] === "2026-09-13"));
    assert.ok(summary.some((row) => row[0] === "validator" && row[1] === "0.24.0-test"));
    assert.ok(summary.some((row) => row[0] === "non-conforming" && row[1] === 1));
  });

  test("is a table the core contract accepts", () => {
    // TheReportIsAValidTable
    const report = buildConformityReport(readBatch(batch), context, options);
    assert.ok(report.table);
    const verdict = parseStructuredExchange(report.table, checkStructuredExchangeSchema);
    assert.ok(verdict.valid, JSON.stringify(verdict.valid ? [] : verdict.issues));
  });

  test("reads as Markdown: the summary, then each chapter with its requirements, verdicts and violations", () => {
    // AReviewerReadsTheReportAsMarkdown
    const { markdown } = buildConformityReport(readBatch(batch), context, options);
    assert.match(markdown, /^# Conformity report\n\n## Summary\n/);
    assert.match(markdown, /## 1\. Braking\n\n\| id \| requirement \| conformity \| violations \|/);
    assert.match(markdown, /\| REQ-2 \| Brake pressure \| non-conforming \| ARP-derived: A derived requirement does not satisfy an upstream one\. \(→ req-1\) \|/);
  });

  test("a violations cell past the ceiling says how many more, and the Markdown keeps them all", () => {
    const many: ProfileRule[] = Array.from({ length: 40 }, (_, index) => ({
      id: `R-${String(index).padStart(2, "0")}`,
      statement: `A long statement that fills the cell quickly, rule number ${index}, so that forty of them cannot fit.`,
      level: "report",
      element: "requirement",
      when: {},
      then: { safety: ["yes"] },
    }));
    const crowded = { ...context, rules: new Map([[profile.id, many]]) };
    const report = buildConformityReport(readBatch(line("req-1", [{ id: "req-1", text: "Stop", attributes: { safety: "no" } }])), crowded, options);
    assert.ok(report.table, report.tableRefused);
    const cell = ((report.table.data as { rows: Record<string, unknown>[] }).rows.find((row) => row.id === "req-1") as { cells: string[] }).cells[3];
    assert.ok(cell.length <= STRUCTURED_EXCHANGE_CEILINGS.cell, `cell is ${cell.length} characters`);
    assert.match(cell, /… and \d+ more \(see the Markdown report\)/);
    assert.match(report.markdown, /R-39/);
  });

  test("a report past the contract's ceilings is not produced as a table, and its Markdown still is", () => {
    const rows = Array.from({ length: STRUCTURED_EXCHANGE_CEILINGS.rows + 5 }, (_, index) => ({ id: `req-${index}`, text: `Requirement ${index}`, attributes: { category: "direct" } }));
    const huge = rows.map((row) => line(row.id, [row])).join("\n");
    const report = buildConformityReport(readBatch(huge), context, options);
    assert.equal(report.table, undefined);
    assert.match(report.tableRefused ?? "", /split the batch/);
    assert.match(report.markdown, new RegExp(`REQ-${STRUCTURED_EXCHANGE_CEILINGS.rows + 4}`));
  });
});

describe("a report in a project with a default profile", () => {
  test("names the reserved identifier, and is never held to the project's profile", async () => {
    // AReportIsNeverHeldToAProjectsProfile, at the check the agent's tools apply
    const { holdToProfile } = await import("@pi-outpost/shared/structured-exchange/profile-check");
    const { STRUCTURED_EXCHANGE_CONFORMITY_REPORT_PROFILE } = await import("@pi-outpost/shared/structured-exchange/profile");
    const report = buildConformityReport(readBatch(batch), context, options);
    assert.ok(report.table, report.tableRefused);
    assert.equal(report.table.profile, STRUCTURED_EXCHANGE_CONFORMITY_REPORT_PROFILE);
    assert.equal(context.default, profile.id, "the fixture must hold documents to a default");
    assert.deepEqual(holdToProfile(report.table, context), { outcome: "unconstrained" });
  });

  test("carries no conformance statement where the reader sees one, while the same table unnamed would not conform", async () => {
    // AReportIsNeverHeldToAProjectsProfile, as the reader is told
    const { mkdtempSync, mkdirSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const path = (await import("node:path")).default;
    const { structuredConformanceFor } = await import("../src/structuredExchangeProfiles.ts");
    const root = mkdtempSync(path.join(tmpdir(), "conformity-report-default-"));
    mkdirSync(path.join(root, ".pi-outpost"));
    writeFileSync(path.join(root, "requirements.json"), JSON.stringify(profile));
    writeFileSync(
      path.join(root, ".pi-outpost/structured-exchange.json"),
      JSON.stringify({ schema: "urn:structured-exchange-profile-registry:1", profiles: ["requirements.json"], default: profile.id }),
    );
    const report = buildConformityReport(readBatch(batch), context, options);
    assert.ok(report.table, report.tableRefused);

    assert.deepEqual(await structuredConformanceFor(root, [{ toolCallId: "report", structured: JSON.stringify(report.table) }]), []);
    const unnamed = JSON.stringify({ ...report.table, profile: undefined });
    assert.equal((await structuredConformanceFor(root, [{ toolCallId: "unnamed", structured: unnamed }]))[0]?.conformance.state, "strays");
  });
});
