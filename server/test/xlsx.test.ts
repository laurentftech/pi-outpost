/**
 * Spreadsheet extraction: the grid, and every way of getting it subtly wrong.
 *
 * Most of the fixtures come from `test/fixtures/make-xlsx.mjs`, which writes the
 * markup by hand — a sheet whose `r:id` deliberately disagrees with its part
 * name, a row that really skips two columns, a cell that really carries a
 * `numFmtId` nothing resolves. Those are what is being asserted, so they have to
 * be input we control.
 *
 * Two fixtures are not ours: `xlsx-real-onlyoffice` and `xlsx-real-sheets` were
 * written by OnlyOffice and by Google Sheets. Hand-written XML proves our reading
 * of the spec, not anyone's writing of it, and the gap between those two is where
 * the Word reader's surprises lived.
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { describe, test } from "node:test";
import {
  columnFromRef,
  columnLetters,
  extractXlsx,
  parseRelationships,
  parseRowRange,
  parseSharedStrings,
  parseStyles,
  parseWorkbook,
  rowFromRef,
  XlsxError,
} from "../src/xlsx.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(HERE, "fixtures");

async function fixture(name: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(path.join(FIXTURES, `${name}.xlsx`)));
}

/** The failure the call produced, or a message saying it produced none. */
async function failureOf(bytes: Uint8Array, options = {}): Promise<XlsxError> {
  try {
    const result = await extractXlsx(bytes, options);
    assert.fail(`expected a failure, got: ${result.markdown.slice(0, 120)}`);
  } catch (error) {
    assert.ok(error instanceof XlsxError, `expected an XlsxError, got ${String(error)}`);
    return error;
  }
}

/** The row of a rendered table whose first cell is the row number given. */
function tableRow(markdown: string, rowNumber: number): string {
  const line = markdown.split("\n").find((candidate) => candidate.startsWith(`| ${rowNumber} |`));
  assert.ok(line !== undefined, `no rendered row ${rowNumber} in:\n${markdown}`);
  return line;
}

describe("cell references", () => {
  test("columns are base 26 with no zero digit", () => {
    // Z+1 rolls to AA, not to BA — the mistake that puts column 27 at index 53
    assert.equal(columnFromRef("A1"), 1);
    assert.equal(columnFromRef("Z9"), 26);
    assert.equal(columnFromRef("AA1"), 27);
    assert.equal(columnFromRef("XFD1"), 16_384);
  });

  test("letters and indices are inverses", () => {
    for (const column of [1, 26, 27, 52, 53, 702, 703, 16_384]) {
      assert.equal(columnFromRef(columnLetters(column)), column, `column ${column}`);
    }
  });

  test("a reference's row is its trailing digits", () => {
    assert.equal(rowFromRef("AB123"), 123);
    assert.equal(rowFromRef("AB"), 0);
  });
});

describe("row ranges", () => {
  test("a single row, a range, a list and an open end", () => {
    assert.deepEqual(parseRowRange("12"), [{ from: 12, to: 12 }]);
    assert.deepEqual(parseRowRange("5-40"), [{ from: 5, to: 40 }]);
    assert.deepEqual(parseRowRange("5-40,80"), [{ from: 5, to: 40 }, { from: 80, to: 80 }]);
    assert.deepEqual(parseRowRange("501-"), [{ from: 501, to: Number.POSITIVE_INFINITY }]);
  });

  test("a huge range stays two numbers, not a million of them", () => {
    // Intervals rather than a set: "1-1048576" must cost nothing to express
    const intervals = parseRowRange("1-1048576");
    assert.equal(intervals.length, 1);
    assert.equal(intervals[0]?.to, 1_048_576);
  });

  test("nonsense is refused with the shapes that work", () => {
    for (const spec of ["abc", "0", "40-5", "-", ""]) {
      assert.throws(() => parseRowRange(spec), XlsxError, `"${spec}" was accepted`);
    }
  });
});

describe("workbook parts", () => {
  test("a sheet's part comes from its relationship, never from its position", async () => {
    // xlsx-sheets names them in an order the part names contradict on purpose
    const workbookXml = await partOf("xlsx-sheets", "xl/workbook.xml");
    const relsXml = await partOf("xlsx-sheets", "xl/_rels/workbook.xml.rels");
    const { sheets } = parseWorkbook(workbookXml);
    const targets = parseRelationships(relsXml);

    assert.deepEqual(sheets.map((sheet) => sheet.name), ["Ventes", "Stocks", "Calculs"]);
    assert.equal(targets.get(sheets[0]!.relationshipId), "xl/worksheets/sheet2.xml");
    assert.equal(targets.get(sheets[1]!.relationshipId), "xl/worksheets/sheet3.xml");
  });

  test("shared strings join their runs and drop phonetic guides", async () => {
    const strings = parseSharedStrings(await partOf("xlsx-strings", "xl/sharedStrings.xml"));
    assert.equal(strings[0], "Café noir");
    assert.equal(strings[1], "東京");
  });

  test("only cellXfs feeds the style table, not cellStyleXfs", async () => {
    // Counting both shifts every format by one and shows a date as a percentage
    const styles = parseStyles(await partOf("xlsx-formats", "xl/styles.xml"));
    assert.equal(styles.numberFormatByStyle.length, 9);
    assert.equal(styles.numberFormatByStyle[1], 14);
    assert.equal(styles.formatCodes.get(164), '"€"#,##0.00');
  });
});

describe("the grid", () => {
  test("a skipped column stays skipped instead of sliding values left", async () => {
    const { markdown } = await extractXlsx(await fixture("xlsx-grid"));

    // Row 1 holds A1 and E1 only: "alpha" and "omega" are three columns apart
    const first = tableRow(markdown, 1);
    assert.match(first, /^\| 1 \| alpha \|\s*\| omega \|$/);
  });

  test("the header carries the workbook's letters, so a removed column shows as a gap", async () => {
    // C and D are hidden. Compacting without saying so would read as A | B | C
    const { markdown } = await extractXlsx(await fixture("xlsx-grid"));

    assert.match(markdown, /\|\s+\| A \| B \| E \|/);
    assert.doesNotMatch(markdown, /\| C \|/);
    assert.match(markdown, /2 hidden columns not read/);
    // The value in a hidden column does not come through under another letter
    assert.doesNotMatch(markdown, /\b7\b/);
  });

  test("a hidden column's unresolvable format is not counted in the note", async () => {
    // D2 carries a format nothing resolves, and D is hidden: announcing a marked
    // cell would send the reader looking for a `*` that is not in the table.
    const { markdown } = await extractXlsx(await fixture("xlsx-grid"));
    assert.doesNotMatch(markdown, /number format could not be resolved/);
  });

  test("rows keep their own numbers, so the table is addressable", async () => {
    // Row 3 is empty and absent; row 4 must still be called 4
    const { markdown } = await extractXlsx(await fixture("xlsx-grid"));
    assert.match(tableRow(markdown, 4), /\| 99 \|/);
    assert.doesNotMatch(markdown, /^\| 3 \|/m);
  });

  test("inline strings are content like any other", async () => {
    const { markdown } = await extractXlsx(await fixture("xlsx-strings"));
    assert.match(markdown, /inline value/);
  });

  test("a cell that would break a table is escaped, not dropped", async () => {
    const { markdown } = await extractXlsx(await fixture("xlsx-strings"));
    const row = tableRow(markdown, 2);
    assert.match(row, /a \\\| b/);
    assert.match(row, /back\\\\slash/);
    // Escaping done right leaves the row exactly as wide as the header
    assert.equal(row.split(" | ").length, 3);
  });
});

describe("values as displayed", () => {
  test("a date serial reads as a date and a fraction as a time", async () => {
    const { markdown } = await extractXlsx(await fixture("xlsx-formats"));

    assert.match(tableRow(markdown, 1), /\| 2024-01-01 \|/);
    assert.match(tableRow(markdown, 7), /\| 2024-01-01 12:00:00 \|/);
    assert.doesNotMatch(markdown, /45292/);
  });

  test("a percentage, a currency and a fixed precision come from the format", async () => {
    const { markdown } = await extractXlsx(await fixture("xlsx-formats"));

    assert.match(tableRow(markdown, 2), /\| 15% \|/);
    assert.match(tableRow(markdown, 3), /\| €1234\.50 \|/);
    assert.match(tableRow(markdown, 5), /\| 0\.12 \|/);
    assert.match(tableRow(markdown, 11), /\| -€12\.00 \|/);
  });

  test("a built-in currency id invents no symbol the file never stated", async () => {
    // Style 6 is numFmtId 44, whose symbol comes from the reader's system
    const { markdown } = await extractXlsx(await fixture("xlsx-formats"));
    assert.match(tableRow(markdown, 6), /\| 1234\.50 \|/);
  });

  test("an unresolvable format marks the cell and counts it in a note", async () => {
    // Both, not either: the mark says which value is raw, the note says how many
    const { markdown } = await extractXlsx(await fixture("xlsx-formats"));

    assert.match(tableRow(markdown, 4), /\| 42\* \|/);
    assert.match(markdown, /> \* 1 cell: the number format could not be resolved/);
  });

  test("booleans and error values read as the workbook holds them", async () => {
    const { markdown } = await extractXlsx(await fixture("xlsx-formats"));
    assert.match(tableRow(markdown, 9), /\| TRUE \|/);
    assert.match(tableRow(markdown, 10), /\| #DIV\/0! \|/);
  });

  test("the 1900 phantom day is rendered rather than shifted away", async () => {
    // Serial 60 is 1900-02-29, a day that never happened. Excel counts it, so we
    // do: silently renumbering it moves every earlier date by one.
    const { markdown } = await extractXlsx(await fixture("xlsx-formats"));
    assert.match(tableRow(markdown, 8), /\| 1900-02-29 \|/);
  });

  test("the 1904 date system shifts the same serial", async () => {
    const { markdown } = await extractXlsx(await fixture("xlsx-1904"));
    assert.match(markdown, /2028-01-02/);
  });

  test("a computed cell shows its stored result", async () => {
    // The last result the workbook recorded — not what a recalculation would give
    const { markdown } = await extractXlsx(await fixture("xlsx-formulas"));
    assert.match(tableRow(markdown, 1), /\| 1240 \|/);
    assert.doesNotMatch(markdown, /SUM\(/);
  });

  test("a formula never computed says so instead of reading as empty", async () => {
    const { markdown } = await extractXlsx(await fixture("xlsx-formulas"));
    assert.match(tableRow(markdown, 2), /\(uncomputed\)/);
  });
});

describe("coverage without a sheet", () => {
  test("every visible sheet is returned, in workbook order", async () => {
    const result = await extractXlsx(await fixture("xlsx-two-sheets"));

    assert.deepEqual(result.sheets, ["First", "Second"]);
    assert.ok(result.markdown.indexOf("## First") < result.markdown.indexOf("## Second"));
  });

  test("a hidden sheet is not returned and its absence is stated", async () => {
    const result = await extractXlsx(await fixture("xlsx-sheets"));

    assert.deepEqual(result.sheets, ["Ventes", "Stocks"]);
    assert.doesNotMatch(result.markdown, /secret/);
    assert.match(result.markdown, /1 hidden sheet not read: "Calculs"/);
  });

  test("asking for a hidden sheet by name is refused, not silently empty", async () => {
    const error = await failureOf(await fixture("xlsx-sheets"), { sheet: "Calculs" });
    assert.equal(error.reason, "unreadable");
    assert.match(error.message, /hidden/);
  });

  test("a sheet name the workbook does not have lists the ones it does", async () => {
    const error = await failureOf(await fixture("xlsx-sheets"), { sheet: "Ventés" });
    assert.match(error.message, /Visible sheets: "Ventes", "Stocks"/);
  });

  test("one sheet by name returns that sheet and nothing else", async () => {
    const result = await extractXlsx(await fixture("xlsx-two-sheets"), { sheet: "Second" });

    assert.deepEqual(result.sheets, ["Second"]);
    assert.doesNotMatch(result.markdown, /## First/);
  });

  test("a workbook whose sheets hold no cells says so rather than returning silence", async () => {
    const result = await extractXlsx(await fixture("xlsx-empty"));

    assert.equal(result.rowsCovered, 0);
    assert.match(result.markdown, /no cell content/);
    assert.match(result.markdown, /Charts, pivot tables, images/);
  });
});

describe("caps", () => {
  test("only the rows asked for are read", async () => {
    const result = await extractXlsx(await fixture("xlsx-long"), { rows: "5-7" });

    assert.equal(result.rowsCovered, 3);
    assert.match(tableRow(result.markdown, 5), /\| 5 \|/);
    assert.doesNotMatch(result.markdown, /^\| 4 \|/m);
  });

  test("a truncated read names the sheet and the range to ask for next", async () => {
    const result = await extractXlsx(await fixture("xlsx-long"), { maxRows: 10 });

    assert.equal(result.rowsCovered, 10);
    assert.match(result.markdown, /Truncated at sheet "Long", row 11\./);
    assert.match(result.markdown, /sheet="Long" rows="11-40"/);
  });

  test("a sheet the budget did not reach is named rather than left out", async () => {
    const result = await extractXlsx(await fixture("xlsx-two-sheets"), { maxRows: 5 });

    assert.deepEqual(result.sheets, ["First"]);
    assert.match(result.markdown, /Sheets not reached in this call: "Second"/);
  });

  test("full lifts the per-call caps", async () => {
    const result = await extractXlsx(await fixture("xlsx-two-sheets"), { full: true });

    assert.deepEqual(result.sheets, ["First", "Second"]);
    assert.equal(result.rowsCovered, 40);
    assert.doesNotMatch(result.markdown, /Truncated/);
  });

  test("full refuses rather than returning a workbook cut in half", async () => {
    // The option exists to remove truncation; a truncated "whole workbook" would
    // be the exact failure it was added to prevent
    const error = await failureOf(await fixture("xlsx-long"), { full: true, maxChars: 200 });
    assert.equal(error.reason, "too-large");
    assert.match(error.message, /output_path/);
  });
});

describe("failures", () => {
  test("a zip that is not an Office package is refused as unreadable", async () => {
    const error = await failureOf(await fixture("xlsx-not-office"));
    assert.equal(error.reason, "unreadable");
    assert.match(error.message, /Office package/);
  });

  test("an Office package that is not a workbook says which part is missing", async () => {
    const error = await failureOf(await fixture("xlsx-no-workbook"));
    assert.equal(error.reason, "unreadable");
    assert.match(error.message, /xl\/workbook\.xml/);
  });

  test("a file that is not a zip is refused as unreadable", async () => {
    assert.equal((await failureOf(await fixture("xlsx-corrupt"))).reason, "unreadable");
  });

  test("an encrypted workbook says so instead of reporting damage", async () => {
    const error = await failureOf(await fixture("xlsx-encrypted"));
    assert.equal(error.reason, "encrypted");
    assert.match(error.message, /password-protected/);
  });

  test("a part that expands past the budget stops while it expands", async () => {
    const error = await failureOf(await fixture("xlsx-bomb"));
    assert.equal(error.reason, "too-large");
  });

  test("a parse that outruns its budget fails instead of hanging", async () => {
    // -1, not 0: with a zero budget the whole parse can finish inside the same
    // millisecond on a fast machine, and the test would pass or fail by luck.
    const error = await failureOf(await fixture("xlsx-long"), { timeoutMs: -1 });
    assert.equal(error.reason, "budget");
  });
});

describe("workbooks written by real software", () => {
  test("a OnlyOffice workbook reads as its grid", async () => {
    const result = await extractXlsx(await fixture("xlsx-real-onlyoffice"));

    assert.deepEqual(result.sheets, ["Feuille1"]);
    assert.match(tableRow(result.markdown, 1), /\| Issue \| Feature \| Our Status \|/);
    assert.match(result.markdown, /Auto-delete on iOS/);
  });

  test("a Google Sheets workbook resolves its custom date format", async () => {
    // Sheets writes the timestamps under a workbook-defined numFmt, not a
    // built-in one. Without the styles chain these read as 44940.85…
    const result = await extractXlsx(await fixture("xlsx-real-sheets"), { sheet: "Form responses 1", rows: "2" });

    assert.match(result.markdown, /2023-01-14 20:26:19/);
    assert.doesNotMatch(result.markdown, /4494\d\.\d/);
  });

  test("its sheets come from the relationships, not from the part order", async () => {
    // rId1 in this workbook is the theme; the sheets are rId5, rId6, rId7. A
    // reader mapping position to sheetN.xml reads the theme as the first sheet.
    const result = await extractXlsx(await fixture("xlsx-real-sheets"), { rows: "1" });

    assert.equal(result.sheetCount, 3);
    assert.deepEqual(result.sheets, [
      "Form responses 1",
      "⚠️ HOW TO ADD TO THIS LIST ⚠️",
      "All Working Modules View",
    ]);
  });
});

describe("determinism", () => {
  test("the same workbook renders identically under another timezone and locale", async () => {
    // Nothing here may reach for Intl or for a local-time getter: a date that
    // reads 2024-01-01 in Paris and 2023-12-31 in Los Angeles is a wrong answer
    // in one of the two, and the caller cannot tell which.
    const [paris, la] = await Promise.all([
      renderIn({ TZ: "Europe/Paris", LANG: "fr_FR.UTF-8" }),
      renderIn({ TZ: "America/Los_Angeles", LANG: "en_US.UTF-8" }),
    ]);

    assert.equal(paris, la);
    assert.match(paris, /2024-01-01/);
  });
});

/** Extract the formats fixture in a child process with the environment given. */
async function renderIn(env: Record<string, string>): Promise<string> {
  // The module is imported as a file:// URL, not as a path: on Windows an
  // absolute path starts with a drive letter, which the ESM loader reads as an
  // unsupported "d:" scheme. readFile takes the plain path, which it wants.
  const module = pathToFileURL(path.join(HERE, "..", "src", "xlsx.ts")).href;
  const script =
    `import { readFile } from "node:fs/promises";` +
    `import { extractXlsx } from ${JSON.stringify(module)};` +
    `const bytes = new Uint8Array(await readFile(${JSON.stringify(path.join(FIXTURES, "xlsx-formats.xlsx"))}));` +
    `process.stdout.write((await extractXlsx(bytes)).markdown);`;

  const { stdout } = await promisify(execFile)(
    process.execPath,
    ["--import", "tsx/esm", "--input-type=module", "--eval", script],
    { env: { ...process.env, ...env }, cwd: path.join(HERE, "..") },
  );
  return stdout;
}

/** One part of a fixture package, as text — for the parsers that take XML. */
async function partOf(name: string, part: string): Promise<string> {
  const { readZipEntry } = await import("../src/zip.ts");
  const bytes = await readFile(path.join(FIXTURES, `${name}.xlsx`));
  const entry = readZipEntry(bytes, part, { maxEntries: 64, maxInflatedBytes: 8 * 1024 * 1024 });
  assert.ok(entry !== null, `fixture ${name} has no ${part}`);
  return entry.toString("utf8");
}
