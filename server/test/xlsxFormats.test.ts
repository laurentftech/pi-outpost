/**
 * Number formats: the part of spreadsheet reading that can be wrong invisibly.
 *
 * Every other failure in the reader announces itself — a missing sheet, a
 * refused package, an empty result. A misresolved format returns a number that
 * looks like an answer, so these tests carry more weight than their size
 * suggests.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  analyzeFormatSection,
  formatForStyle,
  formatCodeFor,
  parseFormatCode,
  renderNumericValue,
  serialToDate,
  type WorkbookStyles,
} from "../src/xlsxFormats.ts";

/** A style table where index N points at the id given, so tests read as intent. */
function styles(ids: number[], custom: Array<[number, string]> = []): WorkbookStyles {
  return { numberFormatByStyle: ids, formatCodes: new Map(custom) };
}

/** The rendering of a raw number under the format at style index 0. */
function render(value: number, ids: number[], custom: Array<[number, string]> = [], epoch1904 = false): string {
  const table = styles(ids, custom);
  return renderNumericValue(value, formatForStyle(0, table, value), epoch1904);
}

describe("format kinds", () => {
  test("a date serial under a date format reads as a date, not as its number", () => {
    // The failure this whole module exists to prevent: 45292 is 2024-01-01
    assert.equal(render(45292, [14]), "2024-01-01");
    assert.notEqual(render(45292, [14]), "45292");
  });

  test("a percentage is scaled and signed, not returned as a fraction", () => {
    assert.equal(render(0.15, [9]), "15%");
    assert.equal(render(0.15, [10]), "15.00%");
  });

  test("binary floating point does not leak into a percentage", () => {
    // 0.15 * 100 is 15.000000000000002; the format's precision settles it
    assert.ok(!render(0.15, [9]).includes("000000"));
  });

  test("the format's declared precision is applied, not the stored one", () => {
    assert.equal(render(0.1234, [2]), "0.12");
    assert.equal(render(1234.5, [4]), "1234.50");
  });

  test("a built-in currency id invents no symbol", () => {
    // Ids 5-8 and 41-44 take their symbol from the reader's system, so the file
    // states none. Rendering "$" or "€" here would be a guess about the host.
    for (const id of [5, 6, 7, 8, 41, 42, 43, 44]) {
      const rendered = render(1234.5, [id]);
      assert.ok(/^\d/.test(rendered), `id ${id} rendered "${rendered}" with a leading symbol`);
    }
  });

  test("a workbook's own format states its symbol and keeps it", () => {
    assert.equal(render(1234.5, [164], [[164, '"€"#,##0.00']]), "€1234.50");
    assert.equal(render(1234.5, [164], [[164, "[$£-809]#,##0.00"]]), "£1234.50");
  });

  test("a negative amount keeps the sign outside the symbol", () => {
    // "-€12.00" cannot be misread; "€-12.00" invites reading "€-" as the symbol
    assert.equal(render(-12, [164], [[164, '"€"#,##0.00']]), "-€12.00");
  });

  test("a custom date format is applied by kind, not by its own layout", () => {
    // The layout is Excel's; the rendering is ours and deliberately fixed
    assert.equal(render(45292.25, [164], [[164, "dd/mm/yyyy hh:mm"]]), "2024-01-01 06:00:00");
  });

  test("a workbook's definition overrides the built-in table for the same id", () => {
    assert.equal(formatCodeFor(14, new Map([[14, "yyyy"]])), "yyyy");
    assert.equal(formatCodeFor(14, new Map()), "mm-dd-yy");
  });
});

describe("reading a format code", () => {
  test("m is minutes next to an hour and months everywhere else", () => {
    // The one genuinely ambiguous character in the grammar
    assert.deepEqual(analyzeFormatSection("mm-dd-yy"), { kind: "datetime", date: true, time: false });
    assert.deepEqual(analyzeFormatSection("h:mm"), { kind: "datetime", date: false, time: true });
    assert.deepEqual(analyzeFormatSection("mm:ss"), { kind: "datetime", date: false, time: true });
    assert.deepEqual(analyzeFormatSection("m/d/yy h:mm"), { kind: "datetime", date: true, time: true });
  });

  test("a quoted literal is text, not a pattern", () => {
    // "May" would otherwise read as month-day-year and turn a price into a date
    const format = analyzeFormatSection('0.00" May"');
    assert.equal(format.kind, "number");
  });

  test("a colour and a locale prefix are stepped over", () => {
    assert.deepEqual(analyzeFormatSection("[Red]0.00"), { kind: "number", decimals: 2 });
    assert.deepEqual(analyzeFormatSection("[$-409]0.0"), { kind: "number", decimals: 1 });
  });

  test("a bracketed currency is a symbol, a bracketed locale is not", () => {
    assert.deepEqual(analyzeFormatSection("[$€-407]#,##0.00"), { kind: "currency", symbol: "€", decimals: 2 });
  });

  test("elapsed time is time", () => {
    assert.deepEqual(analyzeFormatSection("[h]:mm:ss"), { kind: "datetime", date: false, time: true });
  });

  test("@ is text and General is general", () => {
    assert.deepEqual(analyzeFormatSection("@"), { kind: "text" });
    assert.deepEqual(analyzeFormatSection("General"), { kind: "general" });
  });

  test("width and fill characters never become content", () => {
    // `_(` reserves the width of a bracket and `* ` repeats a space
    assert.deepEqual(analyzeFormatSection('_(* #,##0.00_)'), { kind: "number", decimals: 2 });
  });

  test("a section is chosen by the value's sign", () => {
    const code = "0.000;[Red]0.0;-";
    assert.deepEqual(parseFormatCode(code, 5), { kind: "number", decimals: 3 });
    assert.deepEqual(parseFormatCode(code, -5), { kind: "number", decimals: 1 });
  });

  test("a semicolon inside a literal does not split sections", () => {
    const format = parseFormatCode('0.00" a;b"', 1);
    assert.deepEqual(format, { kind: "number", decimals: 2 });
  });
});

describe("date serials", () => {
  test("the 1900 system counts a February 29th that never happened", () => {
    // Lotus 1-2-3 had the bug and Excel kept it deliberately, so it is part of
    // the format. Serial 60 IS that day; 61 is the first of March.
    assert.deepEqual(serialToDate(59, false), dateParts(1900, 2, 28));
    assert.deepEqual(serialToDate(60, false), dateParts(1900, 2, 29));
    assert.deepEqual(serialToDate(61, false), dateParts(1900, 3, 1));
  });

  test("serial 1 is the first of January 1900", () => {
    assert.deepEqual(serialToDate(1, false), dateParts(1900, 1, 1));
  });

  test("the 1904 system shifts every serial by four years and a day", () => {
    assert.deepEqual(serialToDate(0, true), dateParts(1904, 1, 1));
    assert.equal(render(45292, [14], [], true), "2028-01-02");
  });

  test("a fraction of a day is a time of day", () => {
    assert.equal(render(45292.5, [22]), "2024-01-01 12:00:00");
    assert.equal(render(0.25, [21]), "06:00:00");
  });

  test("a fraction that rounds to a whole day carries into the next one", () => {
    assert.equal(render(45292.9999999, [22]), "2024-01-02 00:00:00");
  });

  test("a negative serial is not a date whatever the format claims", () => {
    // Excel shows ###### for these; a number is the honest answer
    assert.equal(serialToDate(-1, false), null);
    assert.equal(render(-1, [14]), "-1");
  });
});

describe("when the chain breaks", () => {
  test("an id neither built in nor defined is unresolved, never defaulted", () => {
    // Falling back to General would return the raw number as though it were the
    // displayed one — exactly the plausible-but-wrong table to avoid
    assert.deepEqual(formatForStyle(0, styles([200]), 42), { kind: "unresolved" });
  });

  test("the reserved locale-specific ids are unresolved rather than guessed", () => {
    for (const id of [23, 30, 36]) {
      assert.deepEqual(formatForStyle(0, styles([id]), 1), { kind: "unresolved" }, `id ${id}`);
    }
  });

  test("a style index past the table is unresolved", () => {
    assert.deepEqual(formatForStyle(7, styles([0, 14]), 1), { kind: "unresolved" });
  });

  test("no style at all is general, which is not a break", () => {
    assert.deepEqual(formatForStyle(undefined, styles([]), 1), { kind: "general" });
  });

  test("a missing numFmtId means General, which is id 0", () => {
    assert.deepEqual(formatForStyle(0, styles([0]), 1), { kind: "general" });
  });
});

/**
 * Scientific notation, against what Excel itself displays.
 *
 * Every expectation below was read off Excel (Pro Plus 2021, numFmtId 11 and 48)
 * for the same value and format code, with Excel's decimal comma swapped for the
 * dot this module writes. This is the one format kind where dropping the
 * presentation drops the value: a mantissa on its own reads as a different
 * number, and `0.00` reads as zero.
 */
describe("scientific notation", () => {
  test("a small number keeps its magnitude instead of collapsing to zero", () => {
    // Excel shows 1,23E-04. Rendering the mantissa alone gives "0.00", which
    // reads as an empty measurement rather than a small one.
    assert.equal(render(0.000123456, [11]), "1.23E-04");
    assert.notEqual(render(0.000123456, [11]), "0.00");
  });

  test("the exponent's sign and width are the format's, not the value's", () => {
    assert.equal(render(12300000000, [11]), "1.23E+10"); // Excel: 1,23E+10
    assert.equal(render(12345.678, [11]), "1.23E+04");
    assert.equal(render(0, [11]), "0.00E+00"); // Excel: 0,00E+00
  });

  test("a negative number signs the mantissa, not the exponent", () => {
    assert.equal(render(-0.00000042, [11]), "-4.20E-07"); // Excel: -4,20E-07
  });

  test("E- writes the sign only when the exponent is negative", () => {
    assert.equal(renderNumericValue(0.000123456, parseFormatCode("0.00E-00", 0.000123456), false), "1.23E-04");
    assert.equal(renderNumericValue(12300000000, parseFormatCode("0.00E-00", 12300000000), false), "1.23E10");
  });

  test("more than one integer placeholder is engineering notation", () => {
    // Built-in 48 is ##0.0E+0: Excel holds the exponent to a multiple of 3, so
    // the mantissa carries the extra digits instead of being rounded away.
    assert.equal(render(12300000000, [48]), "12.3E+9"); // Excel: 12,3E+9
    assert.equal(render(0.000123456, [48]), "123.5E-6"); // Excel: 123,5E-6
  });

  test("rounding that overflows the mantissa moves the exponent", () => {
    // 9.99e5 at one decimal rounds to 10.0, which is not a mantissa; the
    // exponent takes the step so the reading stays 1.0E+06.
    assert.equal(renderNumericValue(999900, parseFormatCode("0.0E+00", 999900), false), "1.0E+06");
  });

  test("the format's kind and declared widths are read off the code", () => {
    assert.deepEqual(analyzeFormatSection("0.00E+00"), {
      kind: "scientific",
      decimals: 2,
      exponentDigits: 2,
      integerDigits: 1,
      plusSign: true,
    });
    assert.deepEqual(analyzeFormatSection("##0.0E+0"), {
      kind: "scientific",
      decimals: 1,
      exponentDigits: 1,
      integerDigits: 3,
      plusSign: true,
    });
  });

  test("a date format is still a date, and a percentage still a percentage", () => {
    // The exponent check runs before the plain-number path; it must not reach past it.
    assert.deepEqual(analyzeFormatSection("yyyy-mm-dd"), { kind: "datetime", date: true, time: false });
    assert.deepEqual(analyzeFormatSection("0.00%"), { kind: "percent", decimals: 2 });
  });
});

function dateParts(year: number, month: number, day: number) {
  return { year, month, day, hours: 0, minutes: 0, seconds: 0 };
}
