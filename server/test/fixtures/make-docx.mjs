/**
 * Builds the .docx fixtures the extraction tests read.
 *
 * Written by hand, like the PDF ones and for the same reason: the tests need
 * documents whose markup is exactly what we say it is — a tracked deletion that
 * really is a `<w:del>`, a table that really declares three columns. A generator
 * we control is the only way to assert on those.
 *
 * The zip is written here too (stored entries, no compression) so this script
 * needs nothing installed either.
 *
 *   node server/test/fixtures/make-docx.mjs
 */
import { deflateRawSync } from "node:zlib";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { crc32 } from "node:zlib";

const HERE = path.dirname(fileURLToPath(import.meta.url));

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

/** Wrap body markup in the document part's envelope. */
function document(body) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${body}</w:body>
</w:document>`;
}

const para = (text, style) =>
  `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ""}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

const cell = (text) => `<w:tc><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;
const rowOf = (cells) => `<w:tr>${cells.map(cell).join("")}</w:tr>`;
const table = (rows) => `<w:tbl>${rows.map(rowOf).join("")}</w:tbl>`;

/** A zip written by hand: stored or deflated entries, local headers, central directory. */
function zip(entries, { compress = true } = {}) {
  const files = [];
  const chunks = [];
  let offset = 0;

  for (const [name, content] of Object.entries(entries)) {
    const raw = Buffer.from(content, "utf8");
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

const docx = (body, extra = {}) =>
  zip({ "[Content_Types].xml": CONTENT_TYPES, "word/document.xml": document(body), ...extra });

const TABLE_ROWS = [
  ["Region", "Units", "Revenue"],
  ["North", "1200", "48000"],
  ["South", "900", "36500"],
];

const fixtures = {
  // Headings and paragraphs
  "docx-text.docx": docx(
    [
      para("Quarterly Report", "Heading1"),
      para("Revenue grew in every region this quarter."),
      para("Outlook", "Heading2"),
      para("The second half depends on the supply chain."),
    ].join(""),
  ),

  // A table on its own
  "docx-table.docx": docx(table(TABLE_ROWS)),

  // Heading, paragraph, table, closing paragraph — reading order must survive
  "docx-mixed.docx": docx(
    [
      para("Sales by region", "Heading1"),
      para("The table below breaks the quarter down by region."),
      table(TABLE_ROWS),
      para("Figures are provisional until the audit closes."),
    ].join(""),
  ),

  // A tracked insertion and a tracked deletion in one paragraph
  "docx-tracked.docx": docx(
    `<w:p><w:r><w:t xml:space="preserve">The rate is </w:t></w:r>` +
      `<w:ins w:id="1" w:author="Ada"><w:r><w:t>fifteen</w:t></w:r></w:ins>` +
      `<w:del w:id="2" w:author="Ada"><w:r><w:delText>SEVENTY-NINE</w:delText></w:r></w:del>` +
      `<w:r><w:t xml:space="preserve"> percent.</w:t></w:r></w:p>` +
      `<w:del w:id="3" w:author="Ada"><w:p><w:r><w:delText>DELETED PARAGRAPH</w:delText></w:r></w:p></w:del>`,
  ),

  // Body text only in a header part: the body itself has nothing
  "docx-header-only.docx": docx("", {
    "word/header1.xml": document(para("Confidential — internal only")),
  }),

  // Entities, a quoted ">" in an attribute, a comment, and CDATA
  "docx-escapes.docx": docx(
    `<!-- a comment that is not content -->` +
      `<w:p><w:r><w:t xml:space="preserve">a &amp; b &lt; c &#233;t&#233;</w:t></w:r></w:p>` +
      `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Greater &gt; than</w:t></w:r></w:p>` +
      table([["a | b", "back\\slash"], ["1", "2"]]),
  ),

  // Long enough to exercise the block and character caps
  "docx-long.docx": docx(
    Array.from({ length: 60 }, (_, i) => para(`Paragraph number ${i + 1} of the long document.`)).join(""),
  ),

  // A zip that is not an Office package
  "docx-not-office.docx": zip({ "readme.txt": "just a zip" }),

  // Not a zip at all
  "docx-corrupt.docx": Buffer.from("PK this is not really a zip", "utf8"),

  // An OLE compound file, which is what an encrypted .docx actually is
  "docx-encrypted.docx": Buffer.concat([
    Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
    Buffer.alloc(64),
  ]),
};

// A compression bomb: one part that expands far beyond its stored size
const bomb = zip({
  "[Content_Types].xml": CONTENT_TYPES,
  "word/document.xml": document(para("x".repeat(200 * 1024 * 1024))),
});
fixtures["docx-bomb.docx"] = bomb;

for (const [name, bytes] of Object.entries(fixtures)) {
  await writeFile(path.join(HERE, name), bytes);
  console.log(`${name}: ${bytes.length} bytes`);
}
