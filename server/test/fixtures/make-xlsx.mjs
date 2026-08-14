/**
 * Builds the .xlsx fixtures the extraction tests read.
 *
 * Written by hand, like the .docx ones and for the same reason: the tests need
 * workbooks whose markup is exactly what we say it is — a sheet whose `r:id`
 * deliberately does not match its part name, a cell that really carries
 * `numFmtId="200"` and nothing to resolve it with, a row that really skips two
 * columns. A generator we control is the only way to assert on those.
 *
 * What it cannot do is prove how Excel writes a file, which is why the tests
 * also read a workbook produced by real software.
 *
 *   node server/test/fixtures/make-xlsx.mjs
 */
import { deflateRawSync, crc32 } from "node:zlib";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** A zip written by hand: deflated entries, local headers, central directory. */
function zip(entries, { compress = true } = {}) {
  const files = [];
  const chunks = [];
  let offset = 0;

  for (const [name, content] of Object.entries(entries)) {
    const raw = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8");
    const body = compress ? deflateRawSync(raw) : raw;
    const method = compress ? 8 : 0;
    const nameBytes = Buffer.from(name, "utf8");

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc32(raw), 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);

    chunks.push(local, nameBytes, body);
    files.push({ name: nameBytes, method, crc: crc32(raw), compressed: body.length, raw: raw.length, offset });
    offset += local.length + nameBytes.length + body.length;
  }

  const directoryOffset = offset;
  for (const file of files) {
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(file.method, 10);
    central.writeUInt32LE(file.crc, 16);
    central.writeUInt32LE(file.compressed, 20);
    central.writeUInt32LE(file.raw, 24);
    central.writeUInt16LE(file.name.length, 28);
    central.writeUInt32LE(file.offset, 42);
    chunks.push(central, file.name);
    offset += central.length + file.name.length;
  }

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(offset - directoryOffset, 12);
  eocd.writeUInt32LE(directoryOffset, 16);
  chunks.push(eocd);

  return Buffer.concat(chunks);
}

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

/**
 * The style table every fixture shares.
 *
 * `cellStyleXfs` carries an `<xf>` too, and it must not be counted: a reader
 * that indexes the wrong table shifts every format by one and returns a date
 * where the sheet shows a percentage.
 */
const STYLES = `${XML}
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="2">
    <numFmt numFmtId="164" formatCode="&quot;€&quot;#,##0.00"/>
    <numFmt numFmtId="165" formatCode="dd/mm/yyyy hh:mm"/>
  </numFmts>
  <cellStyleXfs count="1"><xf numFmtId="0"/></cellStyleXfs>
  <cellXfs count="9">
    <xf numFmtId="0"/>
    <xf numFmtId="14"/>
    <xf numFmtId="9"/>
    <xf numFmtId="164"/>
    <xf numFmtId="200"/>
    <xf numFmtId="2"/>
    <xf numFmtId="44"/>
    <xf numFmtId="22"/>
    <xf numFmtId="165"/>
  </cellXfs>
</styleSheet>`;

/** Style indices, by what they mean — the tests read better for it. */
const S = {
  general: 0,
  date: 1,
  percent: 2,
  euro: 3,
  unknown: 4,
  twoDecimals: 5,
  accounting: 6,
  dateTime: 7,
  customDateTime: 8,
};

function sharedStringsPart(items) {
  // A plain string is the common case; markup is how a fixture asks for runs or
  // phonetic guides. Wrapping here keeps the fixtures readable.
  const body = items.map((item) => `<si>${item.startsWith("<") ? item : text(item)}</si>`).join("");
  return `${XML}
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${items.length}" uniqueCount="${items.length}">${body}</sst>`;
}

const text = (value) => `<t xml:space="preserve">${value}</t>`;
const runs = (...parts) => parts.map((part) => `<r>${text(part)}</r>`).join("");

function sheetPart(body, { cols = "", dimension } = {}) {
  const dim = dimension ? `<dimension ref="${dimension}"/>` : "";
  const columns = cols === "" ? "" : `<cols>${cols}</cols>`;
  return `${XML}
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${dim}${columns}<sheetData>${body}</sheetData></worksheet>`;
}

const row = (number, cells) => `<row r="${number}">${cells}</row>`;
/** A cell. `t` omitted means a number, which is what an unmarked cell is. */
const cell = (ref, { t, s, v, f, is } = {}) => {
  const attrs = [`r="${ref}"`, t ? `t="${t}"` : "", s === undefined ? "" : `s="${s}"`].filter(Boolean).join(" ");
  const body = [f === undefined ? "" : `<f>${f}</f>`, v === undefined ? "" : `<v>${v}</v>`, is ?? ""].join("");
  return body === "" ? `<c ${attrs}/>` : `<c ${attrs}>${body}</c>`;
};

/**
 * Assemble a package.
 *
 * `sheets` carry their own relationship id and part name, so a fixture can make
 * them disagree — a workbook whose third `<sheet>` lives in `sheet1.xml` is the
 * case that catches a reader assuming position implies file name.
 */
function workbook({ sheets, strings = [], date1904 = false, styles = STYLES }) {
  const sheetTags = sheets
    .map(
      (sheet, index) =>
        `<sheet name="${sheet.name}" sheetId="${index + 1}"` +
        (sheet.state ? ` state="${sheet.state}"` : "") +
        ` r:id="${sheet.rid}"/>`,
    )
    .join("");
  const relationships = sheets
    .map(
      (sheet) =>
        `<Relationship Id="${sheet.rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="${sheet.part}"/>`,
    )
    .join("");

  const entries = {
    "[Content_Types].xml": `${XML}
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
</Types>`,
    "xl/workbook.xml": `${XML}
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  ${date1904 ? '<workbookPr date1904="1"/>' : ""}
  <sheets>${sheetTags}</sheets>
</workbook>`,
    "xl/_rels/workbook.xml.rels": `${XML}
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationships}</Relationships>`,
    "xl/styles.xml": styles,
  };
  if (strings.length > 0) entries["xl/sharedStrings.xml"] = sharedStringsPart(strings);
  for (const sheet of sheets) entries[`xl/${sheet.part}`] = sheet.xml;
  return zip(entries);
}

/* ── Fixtures ───────────────────────────────────────────────────────────────── */

const fixtures = {};

/*
 * Formats. One row per case, so a failure names the case it broke.
 * 45292 is 2024-01-01; 45292.5 is noon that day; 60 is Excel's phantom day.
 */
fixtures["xlsx-formats.xlsx"] = workbook({
  strings: ["Date", "Percent", "Euro", "Unknown", "Fixed", "Accounting", "DateTime", "Phantom", "Boolean", "Error"],
  sheets: [
    {
      name: "Formats",
      rid: "rId1",
      part: "worksheets/sheet1.xml",
      xml: sheetPart(
        [
          row(1, cell("A1", { t: "s", v: 0 }) + cell("B1", { s: S.date, v: 45292 })),
          row(2, cell("A2", { t: "s", v: 1 }) + cell("B2", { s: S.percent, v: 0.15 })),
          row(3, cell("A3", { t: "s", v: 2 }) + cell("B3", { s: S.euro, v: 1234.5 })),
          row(4, cell("A4", { t: "s", v: 3 }) + cell("B4", { s: S.unknown, v: 42 })),
          row(5, cell("A5", { t: "s", v: 4 }) + cell("B5", { s: S.twoDecimals, v: 0.1234 })),
          row(6, cell("A6", { t: "s", v: 5 }) + cell("B6", { s: S.accounting, v: 1234.5 })),
          row(7, cell("A7", { t: "s", v: 6 }) + cell("B7", { s: S.dateTime, v: 45292.5 })),
          row(8, cell("A8", { t: "s", v: 7 }) + cell("B8", { s: S.date, v: 60 })),
          row(9, cell("A9", { t: "s", v: 8 }) + cell("B9", { t: "b", v: 1 })),
          row(10, cell("A10", { t: "s", v: 9 }) + cell("B10", { t: "e", v: "#DIV/0!" })),
          row(11, cell("A11", { t: "s", v: 2 }) + cell("B11", { s: S.euro, v: -12 })),
          row(12, cell("A12", { t: "s", v: 6 }) + cell("B12", { s: S.customDateTime, v: 45292.25 })),
        ].join(""),
        { dimension: "A1:B12" },
      ),
    },
  ],
});

/*
 * The grid. Row 2 skips two columns; columns C and D are hidden, so the header
 * must read A | B | E and no empty column may stand in for the removed ones.
 */
fixtures["xlsx-grid.xlsx"] = workbook({
  strings: ["alpha", "omega", "left", "right"],
  sheets: [
    {
      name: "Grid",
      rid: "rId1",
      part: "worksheets/sheet1.xml",
      xml: sheetPart(
        [
          row(1, cell("A1", { t: "s", v: 0 }) + cell("E1", { t: "s", v: 1 })),
          // D is hidden and carries a format nothing resolves: neither the value
          // nor the `*` note it would produce may reach the reader.
          row(2, cell("A2", { t: "s", v: 2 }) + cell("D2", { s: S.unknown, v: 7 }) + cell("E2", { t: "s", v: 3 })),
          row(4, cell("B4", { v: 99 })),
        ].join(""),
        { cols: '<col min="3" max="4" hidden="1"/>', dimension: "A1:E4" },
      ),
    },
  ],
});

/* Sheets: the r:id order deliberately disagrees with the part names. */
fixtures["xlsx-sheets.xlsx"] = workbook({
  strings: ["ventes", "stocks", "secret"],
  sheets: [
    {
      name: "Ventes",
      rid: "rId3",
      part: "worksheets/sheet2.xml",
      xml: sheetPart(row(1, cell("A1", { t: "s", v: 0 })), { dimension: "A1:A1" }),
    },
    {
      name: "Stocks",
      rid: "rId1",
      part: "worksheets/sheet3.xml",
      xml: sheetPart(row(1, cell("A1", { t: "s", v: 1 })), { dimension: "A1:A1" }),
    },
    {
      name: "Calculs",
      state: "hidden",
      rid: "rId2",
      part: "worksheets/sheet1.xml",
      xml: sheetPart(row(1, cell("A1", { t: "s", v: 2 })), { dimension: "A1:A1" }),
    },
  ],
});

/* Strings: runs, phonetic guides, inline strings, and cells that could break a table. */
fixtures["xlsx-strings.xlsx"] = workbook({
  strings: [
    `${runs("Café ", "noir")}`,
    `${text("東京")}<rPh sb="0" eb="2">${text("とうきょう")}</rPh>`,
    text("a | b"),
    text("back\\slash"),
  ],
  sheets: [
    {
      name: "Strings",
      rid: "rId1",
      part: "worksheets/sheet1.xml",
      xml: sheetPart(
        [
          row(1, cell("A1", { t: "s", v: 0 }) + cell("B1", { t: "s", v: 1 })),
          row(2, cell("A2", { t: "s", v: 2 }) + cell("B2", { t: "s", v: 3 })),
          row(3, cell("A3", { t: "inlineStr", is: `<is>${text("inline value")}</is>` })),
        ].join(""),
        { dimension: "A1:B3" },
      ),
    },
  ],
});

/* Formulas: one with a cached result, one that has never been computed. */
fixtures["xlsx-formulas.xlsx"] = workbook({
  strings: ["total", "pending"],
  sheets: [
    {
      name: "Calc",
      rid: "rId1",
      part: "worksheets/sheet1.xml",
      xml: sheetPart(
        [
          row(1, cell("A1", { t: "s", v: 0 }) + cell("B1", { f: "SUM(B2:B40)", v: 1240 })),
          row(2, cell("A2", { t: "s", v: 1 }) + cell("B2", { f: "SUM(C2:C40)" })),
        ].join(""),
        { dimension: "A1:B2" },
      ),
    },
  ],
});

/* Long enough to exercise the row and character caps, with a declared dimension. */
fixtures["xlsx-long.xlsx"] = workbook({
  sheets: [
    {
      name: "Long",
      rid: "rId1",
      part: "worksheets/sheet1.xml",
      xml: sheetPart(
        Array.from({ length: 40 }, (_, i) => row(i + 1, cell(`A${i + 1}`, { v: i + 1 }))).join(""),
        { dimension: "A1:A40" },
      ),
    },
  ],
});

/* Two sheets, so "every visible sheet in workbook order" is observable. */
fixtures["xlsx-two-sheets.xlsx"] = workbook({
  sheets: [
    {
      name: "First",
      rid: "rId1",
      part: "worksheets/sheet1.xml",
      xml: sheetPart(Array.from({ length: 20 }, (_, i) => row(i + 1, cell(`A${i + 1}`, { v: i + 1 }))).join("")),
    },
    {
      name: "Second",
      rid: "rId2",
      part: "worksheets/sheet2.xml",
      xml: sheetPart(Array.from({ length: 20 }, (_, i) => row(i + 1, cell(`A${i + 1}`, { v: 100 + i }))).join("")),
    },
  ],
});

/* The 1904 date system: the same serial, four years and a day apart. */
fixtures["xlsx-1904.xlsx"] = workbook({
  date1904: true,
  sheets: [
    {
      name: "Epoch",
      rid: "rId1",
      part: "worksheets/sheet1.xml",
      xml: sheetPart(row(1, cell("A1", { s: S.date, v: 45292 }))),
    },
  ],
});

/* A readable workbook whose sheet holds no cells — a chart sheet, in effect. */
fixtures["xlsx-empty.xlsx"] = workbook({
  sheets: [{ name: "Chart", rid: "rId1", part: "worksheets/sheet1.xml", xml: sheetPart("") }],
});

/* Failure shapes. */
fixtures["xlsx-not-office.xlsx"] = zip({ "readme.txt": "just a zip" });
fixtures["xlsx-no-workbook.xlsx"] = zip({
  "[Content_Types].xml": `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>`,
  "word/document.xml": `${XML}<w:document xmlns:w="x"><w:body/></w:document>`,
});
fixtures["xlsx-corrupt.xlsx"] = Buffer.from("PK this is not really a zip", "utf8");
fixtures["xlsx-encrypted.xlsx"] = Buffer.concat([
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
  Buffer.alloc(64),
]);

/* A compression bomb: one part that expands far beyond its stored size. */
fixtures["xlsx-bomb.xlsx"] = workbook({
  sheets: [
    {
      name: "Bomb",
      rid: "rId1",
      part: "worksheets/sheet1.xml",
      xml: sheetPart(row(1, cell("A1", { t: "inlineStr", is: `<is>${text("x".repeat(70 * 1024 * 1024))}</is>` }))),
    },
  ],
});

for (const [name, bytes] of Object.entries(fixtures)) {
  await writeFile(path.join(HERE, name), bytes);
  console.log(`${name}: ${bytes.length} bytes`);
}
