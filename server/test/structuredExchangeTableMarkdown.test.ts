/**
 * A structured-exchange table as Markdown, without a browser.
 *
 * The assertions read the Markdown back: a table that looks right in a test's string
 * and splits one cell into two in a renderer is exactly the failure an escaping bug
 * produces. The small reader below is GFM's cell rule, nothing more.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { StructuredTableData } from "@pi-outpost/shared/structured-exchange";
import { filterKey } from "@pi-outpost/shared/structured-exchange/model";
import { tableExport, tableMarkdown } from "@pi-outpost/shared/structured-exchange/table-export";

/** Splits one GFM table row into its cells, undoing the export's escapes. */
function readRow(line: string): string[] {
  assert.ok(line.startsWith("| ") && line.endsWith(" |"), `not a table row: ${line}`);
  const inner = line.slice(2, -2);
  const cells: string[] = [];
  let current = "";
  for (let i = 0; i < inner.length; i += 1) {
    const char = inner[i];
    if (char === "\\" && i + 1 < inner.length) {
      current += inner[i + 1];
      i += 1;
    } else if (char === "|" && inner[i - 1] === " " && inner[i + 1] === " ") {
      cells.push(current.slice(0, -1));
      current = "";
      i += 1;
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells.map((cell) => cell.replaceAll("<br>", "\n"));
}

const chaptered: StructuredTableData = {
  columns: ["id", "requirement"],
  rows: [
    { heading: "1. Braking", depth: 1 },
    ["REQ-1", "Stop within 40 m"],
    ["REQ-2", "Warn the driver"],
    { heading: "1.1 Sensing", depth: 2 },
    ["REQ-3", "Read wheel speed"],
  ] as StructuredTableData["rows"],
};

describe("a table as Markdown", () => {
  test("each chapter is a heading followed by a table of its rows under the declared columns", () => {
    // ATableIsTakenAwayAsMarkdown
    const markdown = tableMarkdown(chaptered);
    assert.equal(
      markdown,
      [
        "## 1. Braking",
        "",
        "| id | requirement |",
        "| --- | --- |",
        "| REQ-1 | Stop within 40 m |",
        "| REQ-2 | Warn the driver |",
        "",
        "### 1.1 Sensing",
        "",
        "| id | requirement |",
        "| --- | --- |",
        "| REQ-3 | Read wheel speed |",
        "",
      ].join("\n"),
    );
  });

  test("a pipe, a backslash and a newline keep the table's shape and read back as declared", () => {
    // MarkdownEscapesWhatWouldBreakTheTable
    const tricky = "Stop | or slow\nwithin 40 m, C:\\path";
    const markdown = tableMarkdown({ columns: ["id", "requirement"], rows: [["REQ-1", tricky], ["REQ-2", null]] as StructuredTableData["rows"] });
    const lines = markdown.trimEnd().split("\n");
    assert.equal(lines.length, 4, "a value broke the table into more rows");
    assert.deepEqual(readRow(lines[2]), ["REQ-1", tricky]);
    assert.deepEqual(readRow(lines[3]), ["REQ-2", ""]);
  });

  test("numbers and booleans are written as their values", () => {
    const markdown = tableMarkdown({ columns: ["id", "weight", "safety"], rows: [["REQ-1", 3.5, true]] as StructuredTableData["rows"] });
    assert.deepEqual(readRow(markdown.trimEnd().split("\n")[2]), ["REQ-1", "3.5", "true"]);
  });

  test("rows declaring roles carry them in a column of their own, in the key's words", () => {
    const withRoles: StructuredTableData = {
      columns: ["id"],
      rows: [
        { cells: ["REQ-1"], role: "added" },
        { cells: ["REQ-2"], role: "removed" },
        ["REQ-3"],
      ] as StructuredTableData["rows"],
    };
    const lines = tableMarkdown(withRoles).trimEnd().split("\n");
    assert.deepEqual(readRow(lines[0]), ["id", "change"]);
    // Same words as the CSV export's role column, which uses the key's labels.
    const csvRoles = tableExport(withRoles, new Set()).rows.map((row) => row[row.length - 1]);
    assert.deepEqual(lines.slice(2).map((line) => readRow(line)[1]), csvRoles.map((role) => (role === null ? "" : String(role))));
  });

  test("a narrowed table carries only the rows shown", () => {
    const withRoles: StructuredTableData = {
      columns: ["id"],
      rows: [{ cells: ["REQ-1"], role: "added" }, { cells: ["REQ-2"], role: "removed" }] as StructuredTableData["rows"],
    };
    const markdown = tableMarkdown(withRoles, new Set([filterKey("role", "removed")]));
    assert.match(markdown, /REQ-1/);
    assert.doesNotMatch(markdown, /REQ-2/);
  });

  test("a table with no rows still leaves its header, and rows before any heading form their own table", () => {
    assert.equal(tableMarkdown({ columns: ["id"], rows: [] }), "| id |\n| --- |\n");
    const preamble = tableMarkdown({ columns: ["id"], rows: [["REQ-0"], { heading: "1. Later", depth: 1 }, ["REQ-1"]] as StructuredTableData["rows"] });
    assert.ok(preamble.startsWith("| id |\n| --- |\n| REQ-0 |\n\n## 1. Later\n"), preamble);
  });

  test("is the same function everywhere: it takes data, not a browser", () => {
    // MarkdownExportRunsWithoutABrowser, from the headless side: this suite runs under Node.
    assert.equal(typeof (globalThis as { document?: unknown }).document, "undefined");
    assert.equal(tableMarkdown(chaptered), tableMarkdown(chaptered));
  });
});
