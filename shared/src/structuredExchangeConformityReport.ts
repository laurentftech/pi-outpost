/**
 * A specification checked requirement by requirement, and the report a reviewer reads.
 *
 * Input is JSON Lines in the order of the specification: heading lines, and document
 * lines each holding one or more subject requirements with the links and linked objects
 * the rules need. Output is a structured-exchange table shaped like the specification —
 * its columns, its chapters, one row per requirement — with a conformity verdict and the
 * violations beside every requirement, opened by a summary.
 *
 * A line that cannot be read, or that no registered profile holds, is reported at its
 * number and the batch goes on: one bad export line must not hide the verdict on the
 * other nine thousand.
 *
 * Node-only: it validates documents against the committed schema, as the validator does.
 */
import { STRUCTURED_EXCHANGE_CONFORMITY_REPORT_PROFILE } from "./structuredExchangeProfile.ts";
import { parseStructuredExchange } from "./structuredExchangeParse.ts";
import { checkStructuredExchangeSchema } from "./structuredExchangeSchemaNode.ts";
import {
  STRUCTURED_EXCHANGE_CEILINGS,
  STRUCTURED_EXCHANGE_SCHEMA_V2,
  readTableRow,
  type StructuredTableCell,
  type StructuredTableData,
} from "./structuredExchange.ts";
import { checkAgainstProfile, selectProfile, type ProfileContext } from "./structuredExchangeProfileCheck.ts";
import { evaluateRules, type RuleFinding } from "./structuredExchangeRuleEvaluation.ts";
import { tableMarkdown } from "./structuredExchangeTableExport.ts";
import type { StructuredExchangeIssue } from "./structuredExchangeValidation.ts";

export type BatchEntry =
  | { kind: "heading"; line: number; heading: string; depth: number }
  | { kind: "document"; line: number; document: unknown; subjects?: string[] }
  | { kind: "unreadable"; line: number; reason: string };

export type Conformity = "conforms" | "non-conforming" | "to check";

/** A file the report was checked against, bound to its bytes. */
export interface CheckedAgainst {
  uri: string;
  sha256: string;
}

export interface ConformityReportOptions {
  /** When the run happened, as the summary states it. */
  date: string;
  /** The version of whatever produced the report. */
  version: string;
  /** The profile and rules files used, with their digests. */
  checkedAgainst: readonly CheckedAgainst[];
}

export interface ConformityReport {
  /** The report as a version 2 table — absent when it would exceed the contract's ceilings. */
  table?: Record<string, unknown>;
  /** Why the table was not produced, when it was not. */
  tableRefused?: string;
  /** The report as Markdown, whatever its size, never truncated. */
  markdown: string;
  counts: Record<Conformity, number>;
  /** Violations and not-verifiable findings per rule, each counted once across the batch. */
  perRule: Record<string, number>;
  unreadable: { line: number; reason: string }[];
}

const CONFORMITY_COLUMN = "conformity";
const VIOLATIONS_COLUMN = "violations";

/** The lines of a batch, each classified; never throws on a bad line. */
export function readBatch(text: string): BatchEntry[] {
  const entries: BatchEntry[] = [];
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = index + 1;
    if (raw.trim() === "") return;
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch (error) {
      entries.push({ kind: "unreadable", line, reason: `not JSON: ${(error as Error).message}` });
      return;
    }
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      entries.push({ kind: "unreadable", line, reason: "a line must be a JSON object" });
      return;
    }
    const record = value as Record<string, unknown>;
    if (typeof record.heading === "string") {
      const depth = typeof record.depth === "number" && Number.isInteger(record.depth) && record.depth >= 1 ? record.depth : 1;
      entries.push({ kind: "heading", line, heading: record.heading, depth });
      return;
    }
    if (record.document !== undefined) {
      const subjects = record.subjects;
      if (subjects !== undefined && !(Array.isArray(subjects) && subjects.every((subject) => typeof subject === "string"))) {
        entries.push({ kind: "unreadable", line, reason: '"subjects" must be a list of row identifiers' });
        return;
      }
      entries.push({ kind: "document", line, document: record.document, ...(subjects === undefined ? {} : { subjects: subjects as string[] }) });
      return;
    }
    if (typeof record.schema === "string") {
      entries.push({ kind: "document", line, document: record });
      return;
    }
    entries.push({ kind: "unreadable", line, reason: 'a line is a heading ({"heading", "depth"}) or a document ({"document", "subjects"})' });
  });
  return entries;
}

/** A requirement's verdict as the report carries it. */
interface ReportedRequirement {
  line: number;
  id?: string;
  ref?: string;
  kind?: string;
  cells: StructuredTableCell[];
  conformity: Conformity;
  violations: string[];
}

/** The identity a finding is counted once by, across every document of the batch. */
function findingIdentity(finding: RuleFinding): string {
  return finding.relationship === undefined ? `${finding.ruleId} item ${finding.item ?? finding.path}` : `${finding.ruleId} link ${finding.relationship}`;
}

function describeFinding(finding: RuleFinding, subject: string): string {
  const statement = `${finding.ruleId}: ${finding.statement}`;
  if (finding.from === undefined || finding.to === undefined) return statement;
  const other = finding.from === subject ? `→ ${finding.to}` : `← ${finding.from}`;
  const outcome = finding.outcome === "not-verifiable" ? "not verifiable here, " : "";
  return `${statement} (${outcome}${other})`;
}

/**
 * A violations cell within the cell ceiling. Nothing is silently dropped: when the list
 * does not fit, the cell says how many more there are and where to read them.
 */
function violationsCell(violations: readonly string[], limit: number): string {
  const full = violations.join("\n");
  if (full.length <= limit) return full;
  const kept: string[] = [];
  for (const [index, violation] of violations.entries()) {
    const suffix = `\n… and ${violations.length - index - 1} more (see the Markdown report)`;
    const candidate = [...kept, violation].join("\n");
    if (candidate.length + suffix.length > limit) break;
    kept.push(violation);
  }
  const more = violations.length - kept.length;
  return `${kept.join("\n")}${kept.length === 0 ? "" : "\n"}… and ${more} more (see the Markdown report)`;
}

export function buildConformityReport(
  entries: readonly BatchEntry[],
  context: ProfileContext,
  options: ConformityReportOptions,
): ConformityReport {
  const unreadable: { line: number; reason: string }[] = entries
    .filter((entry): entry is Extract<BatchEntry, { kind: "unreadable" }> => entry.kind === "unreadable")
    .map(({ line, reason }) => ({ line, reason }));
  let columns: string[] | undefined;
  const sequence: ({ kind: "heading"; heading: string; depth: number } | { kind: "requirement"; requirement: ReportedRequirement })[] = [];
  const seenRequirements = new Map<string, number>();
  const countedFindings = new Set<string>();
  const perRule: Record<string, number> = {};

  for (const entry of entries) {
    if (entry.kind === "unreadable") continue;
    if (entry.kind === "heading") {
      sequence.push({ kind: "heading", heading: entry.heading, depth: entry.depth });
      continue;
    }

    const parsed = parseStructuredExchange(entry.document, checkStructuredExchangeSchema);
    if (!parsed.valid) {
      unreadable.push({ line: entry.line, reason: `not a valid structured-exchange document: ${parsed.issues.map((issue) => `${issue.rule} at ${issue.path || "(document)"}`).join("; ")}` });
      continue;
    }
    const envelope = parsed.envelope;
    if (envelope.kind !== "table") {
      unreadable.push({ line: entry.line, reason: `a ${envelope.kind}, not a table` });
      continue;
    }
    const data = envelope.data as StructuredTableData;
    if (columns === undefined) columns = [...data.columns];
    else if (columns.length !== data.columns.length || columns.some((column, index) => column !== data.columns[index])) {
      unreadable.push({ line: entry.line, reason: `its columns (${data.columns.join(", ")}) differ from the report's (${columns.join(", ")})` });
      continue;
    }
    const selection = selectProfile(envelope, context);
    if (selection.outcome !== "held") {
      unreadable.push({
        line: entry.line,
        reason: selection.outcome === "refused" ? selection.issues.map((issue) => issue.message).join("; ") : "held to no registered profile",
      });
      continue;
    }

    const subjects = entry.subjects === undefined ? undefined : new Set(entry.subjects);
    const vocabulary = checkAgainstProfile(envelope, selection.profile).issues;
    const findings =
      vocabulary.length === 0 ? evaluateRules(envelope, context.rules?.get(selection.profile.id) ?? [], subjects === undefined ? {} : { subjects }) : [];

    // The subject rows of this document, in its order.
    const rows = data.rows
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => readTableRow(row).heading === undefined && !Array.isArray(row))
      .map(({ row, index }) => ({ record: row as unknown as Record<string, unknown>, index }))
      .filter(({ record }) => subjects === undefined || (typeof record.id === "string" && subjects.has(record.id)));

    let duplicate: string | undefined;
    for (const { record } of rows) {
      if (typeof record.id !== "string") continue;
      const first = seenRequirements.get(record.id);
      if (first !== undefined) duplicate = `requirement "${record.id}" is already reported from line ${first}`;
    }
    if (duplicate !== undefined) {
      unreadable.push({ line: entry.line, reason: duplicate });
      continue;
    }

    for (const { record, index } of rows) {
      const id = typeof record.id === "string" ? record.id : undefined;
      if (id !== undefined) seenRequirements.set(id, entry.line);
      const pointer = `/data/rows/${index}`;
      const ownVocabulary: StructuredExchangeIssue[] = vocabulary.filter((issue) => issue.path === pointer || issue.path.startsWith(`${pointer}/`));
      const ownFindings = findings.filter((finding) =>
        finding.relationship === undefined ? finding.path === pointer : id !== undefined && (finding.from === id || finding.to === id),
      );
      for (const finding of ownFindings) {
        const identity = findingIdentity(finding);
        if (countedFindings.has(identity)) continue;
        countedFindings.add(identity);
        perRule[finding.ruleId] = (perRule[finding.ruleId] ?? 0) + 1;
      }
      const refusesHere = ownVocabulary.length > 0 || ownFindings.some((finding) => finding.level === "refuse" && finding.outcome === "violated");
      const conformity: Conformity = refusesHere ? "non-conforming" : ownFindings.length > 0 ? "to check" : "conforms";
      sequence.push({
        kind: "requirement",
        requirement: {
          line: entry.line,
          ...(id === undefined ? {} : { id }),
          ...(typeof record.ref === "string" ? { ref: record.ref } : {}),
          ...(typeof record.kind === "string" ? { kind: record.kind } : {}),
          cells: readTableRow(record as never).cells,
          conformity,
          violations: [
            ...ownVocabulary.map((issue) => `${issue.rule}: ${issue.message}`),
            ...ownFindings.map((finding) => describeFinding(finding, id ?? "")),
          ],
        },
      });
    }
  }

  const reportColumns = [...(columns ?? ["requirement"]), CONFORMITY_COLUMN, VIOLATIONS_COLUMN];
  const width = reportColumns.length;
  const counts: Record<Conformity, number> = { conforms: 0, "non-conforming": 0, "to check": 0 };
  for (const item of sequence) if (item.kind === "requirement") counts[item.requirement.conformity] += 1;

  /** A summary line: a label in the first column, its value in the second, the rest empty. */
  const summaryRow = (label: string, value: StructuredTableCell): StructuredTableCell[] => {
    const row: StructuredTableCell[] = Array.from({ length: width }, () => null);
    row[0] = label;
    row[1] = value;
    return row;
  };
  const summary: unknown[] = [
    { heading: "Summary", depth: 1 },
    summaryRow("requirements", counts.conforms + counts["non-conforming"] + counts["to check"]),
    summaryRow("conforms", counts.conforms),
    summaryRow("non-conforming", counts["non-conforming"]),
    summaryRow("to check", counts["to check"]),
    ...Object.entries(perRule).map(([rule, count]) => summaryRow(`rule ${rule}`, count)),
    summaryRow("unreadable lines", unreadable.length === 0 ? "none" : unreadable.map((item) => item.line).sort((a, b) => a - b).join(", ")),
    summaryRow("checked on", options.date),
    summaryRow("validator", options.version),
  ];

  const rowsOf = (cellLimit: number | undefined): unknown[] => [
    ...summary,
    ...sequence.map((item) => {
      if (item.kind === "heading") return { heading: item.heading, depth: item.depth };
      const { requirement } = item;
      const violations = cellLimit === undefined ? requirement.violations.join("\n") : violationsCell(requirement.violations, cellLimit);
      return {
        ...(requirement.id === undefined ? {} : { id: requirement.id }),
        ...(requirement.ref === undefined ? {} : { ref: requirement.ref }),
        ...(requirement.kind === undefined ? {} : { kind: requirement.kind }),
        cells: [...requirement.cells, requirement.conformity, violations],
      };
    }),
  ];

  const envelope = (rows: unknown[]) => ({
    schema: STRUCTURED_EXCHANGE_SCHEMA_V2,
    kind: "table",
    // Reserved: a report is a verdict on requirements, and is never held to the project's profile.
    profile: STRUCTURED_EXCHANGE_CONFORMITY_REPORT_PROFILE,
    ...(options.checkedAgainst.length === 0
      ? {}
      : { artifacts: options.checkedAgainst.map((file) => ({ rel: "checkedAgainst", uri: file.uri, sha256: file.sha256 })) }),
    data: { columns: reportColumns, rows },
  });

  const full = envelope(rowsOf(undefined));
  const markdown = `# Conformity report\n\n${tableMarkdown(full.data as unknown as StructuredTableData)}`;

  const bounded = envelope(rowsOf(STRUCTURED_EXCHANGE_CEILINGS.cell));
  const verdict = parseStructuredExchange(bounded, checkStructuredExchangeSchema);
  const unreadableSorted = unreadable.sort((a, b) => a.line - b.line);
  if (!verdict.valid) {
    return {
      tableRefused: `the report does not fit the structured-exchange contract (${verdict.issues
        .slice(0, 3)
        .map((issue) => `${issue.rule} at ${issue.path || "(document)"}`)
        .join("; ")}); split the batch by module or chapter — the Markdown report is complete`,
      markdown,
      counts,
      perRule,
      unreadable: unreadableSorted,
    };
  }
  return { table: bounded, markdown, counts, perRule, unreadable: unreadableSorted };
}
