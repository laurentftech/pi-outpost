/**
 * Builds the PDF fixtures the extraction tests read.
 *
 * Written by hand rather than with a library: the tests need documents whose text
 * sits at *known* coordinates (that is the whole input to table reconstruction),
 * and a generator we control is the only way to say "this column starts at x=300"
 * and mean it. Everything here is uncompressed PDF 1.4 syntax.
 *
 *   node server/test/fixtures/make-pdfs.mjs
 */
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** `[{ text, x, y, size?, font? }]` → a content stream drawing each string at its point. */
function contentStream(items) {
  return items
    .map(({ text, x, y, size = 12, font = "F1" }) =>
      `BT /${font} ${size} Tf ${x} ${y} Td (${escapeText(text)}) Tj ET`,
    )
    .join("\n");
}

function escapeText(text) {
  return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

/**
 * Helvetica advance widths, thousandths of an em, for ASCII 32-126, straight from
 * the core-14 metrics.
 *
 * Present because a strike fixture has to place a rectangle *over* a string, and
 * "over" is a width the generator has to know rather than guess: the reader
 * decides what a shape covers by how much of a text item's x range it overlaps,
 * so a fixture whose rectangle is 10 % too short is testing a different case
 * than the one it claims.
 */
const HELVETICA = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

/** Width of a Helvetica string at `size`, in points. */
function textWidth(text, size = 12) {
  let total = 0;
  for (const char of text) {
    const code = char.codePointAt(0);
    total += code >= 32 && code <= 126 ? HELVETICA[code - 32] : 556;
  }
  return (total * size) / 1000;
}

/** `x y w h re f` — the filled rectangle every producer draws a strike or an underline with. */
const filled = (x, y, width, height) => `${x} ${y} ${width} ${height} re f`;

/** A stroked line, which is what a page rule is and a strike is not. */
const stroked = (x1, y1, x2, y2) => `${x1} ${y1} m ${x2} ${y2} l S`;

/**
 * A strike over a string drawn at (x, y): a thin filled rectangle at the height
 * measured on a real Word document, +0.31 × the font size above the baseline.
 */
const strikeOver = (text, x, y, size = 12) => filled(x, y + 0.31 * size, textWidth(text, size), 0.5);

/** An underline under the same string, at the height Word puts one. */
const underlineUnder = (text, x, y, size = 12) => filled(x, y - 0.1 * size, textWidth(text, size), 0.25);

/**
 * Assemble a PDF from page content streams. `extra` adds trailer entries (used to
 * fake an encrypted document).
 */
function buildPdf(pages, { trailerExtra = "", objectsExtra = [], secondFont = false } = {}) {
  const objects = [];
  const pageIds = pages.map((_, i) => 4 + i * 2);
  objects[1] = `<< /Type /Catalog /Pages 2 0 R >>`;
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  objects[3] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`;
  // A second font resource. pdf.js merges consecutive strings into one text item
  // when they share a font, so a fixture that needs separate items — the shape a
  // word processor produces at every formatting boundary — has to change font the
  // way the word processor does. It has to be a *different* font, too: two
  // resources naming Helvetica load as one and merge anyway. Helvetica-Oblique
  // carries the same advance widths, so `textWidth` still holds.
  if (secondFont) objects[30] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique >>`;
  const fontResources = secondFont ? `/F1 3 0 R /F2 30 0 R` : `/F1 3 0 R`;

  pages.forEach((content, i) => {
    const pageId = pageIds[i];
    const contentId = pageId + 1;
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ` +
      `/Resources << /Font << ${fontResources} >> >> /Contents ${contentId} 0 R >>`;
    objects[contentId] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
  });

  for (const [id, body] of objectsExtra) objects[id] = body;

  const count = objects.length;
  let out = "%PDF-1.4\n";
  const offsets = [];
  for (let i = 1; i < count; i++) {
    if (objects[i] === undefined) continue;
    offsets[i] = out.length;
    out += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let i = 1; i < count; i++) {
    out += objects[i] === undefined
      ? `0000000000 65535 f \n`
      : `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  out += `trailer\n<< /Size ${count} /Root 1 0 R${trailerExtra} >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

/** Plain prose over two pages. */
const textDoc = buildPdf([
  contentStream([
    { text: "Quarterly Report", x: 72, y: 720, size: 18 },
    { text: "Revenue grew in every region this quarter.", x: 72, y: 690 },
    { text: "Costs held flat against the same period last year.", x: 72, y: 674 },
  ]),
  contentStream([
    { text: "Outlook", x: 72, y: 720, size: 18 },
    { text: "The second half depends on the supply chain.", x: 72, y: 690 },
  ]),
]);

/** A regular grid: three columns, a header row and three data rows. */
const tableRows = [
  ["Region", "Units", "Revenue"],
  ["North", "1200", "48000"],
  ["South", "900", "36500"],
  ["East", "1500", "61000"],
];
const tableDoc = buildPdf([
  contentStream(
    tableRows.flatMap((row, r) =>
      row.map((cell, c) => ({ text: cell, x: 72 + c * 150, y: 700 - r * 20 })),
    ),
  ),
]);

/** A paragraph, then the same grid: reading order must survive. */
const mixedDoc = buildPdf([
  contentStream([
    { text: "Sales by region", x: 72, y: 740, size: 16 },
    { text: "The table below breaks the quarter down by region.", x: 72, y: 716 },
    ...tableRows.flatMap((row, r) =>
      row.map((cell, c) => ({ text: cell, x: 72 + c * 150, y: 660 - r * 20 })),
    ),
    { text: "Figures are provisional until the audit closes.", x: 72, y: 540 },
  ]),
]);

/** A page with graphics and no text at all — what a scan looks like to us. */
const scanDoc = buildPdf(["0.5 0.5 0.5 rg 100 100 400 500 re f"]);

/** One page of text, one page that is only graphics. */
const mixedScanDoc = buildPdf([
  contentStream([{ text: "Cover page with real text", x: 72, y: 700 }]),
  "0.2 0.2 0.2 rg 80 80 450 600 re f",
]);

/** Ten pages, so page caps and ranges have something to bite on. */
const longDoc = buildPdf(
  Array.from({ length: 10 }, (_, i) =>
    contentStream([
      { text: `Page ${i + 1} heading`, x: 72, y: 720, size: 16 },
      { text: `Body text for page ${i + 1}.`, x: 72, y: 690 },
    ]),
  ),
);

/**
 * An encrypted document. The values are not a real key — pdf.js only has to see
 * /Encrypt and demand a password, which is exactly the state under test.
 */
const encryptedDoc = buildPdf([contentStream([{ text: "secret", x: 72, y: 700 }])], {
  trailerExtra: " /Encrypt 99 0 R /ID [<0102030405060708090a0b0c0d0e0f10> <0102030405060708090a0b0c0d0e0f10>]",
  objectsExtra: [
    [
      99,
      `<< /Filter /Standard /V 2 /R 3 /Length 128 /P -1 ` +
        `/O (0123456789abcdef0123456789abcdef) /U (fedcba9876543210fedcba9876543210) >>`,
    ],
  ],
});

/**
 * A page drawn with a Type3 font whose glyph is an inline image mask.
 *
 * pdf.js compiles that mask into a path when the font loads, and that compiler
 * is the one place text extraction touches `DOMMatrix`. The mask has to carry
 * real edges: a single opaque pixel short-circuits before the matrix is built,
 * and the crash this fixture guards against never fires.
 */
const type3Doc = (() => {
  const mask = String.fromCharCode(0xff, 0x81, 0x81, 0xbd, 0xbd, 0x81, 0x81, 0xff);
  const charProc =
    `8 0 0 0 8 8 d1\nq 8 0 0 8 0 0 cm\n` +
    `BI /IM true /W 8 /H 8 /BPC 1 /D [1 0] ID ${mask}\nEI\nQ\n`;
  return buildPdf([contentStream([{ text: "aaa", x: 72, y: 700, size: 24 }])], {
    objectsExtra: [
      [
        3,
        `<< /Type /Font /Subtype /Type3 /FontBBox [0 0 8 8] /FontMatrix [0.125 0 0 0.125 0 0] ` +
          `/CharProcs 20 0 R /Encoding << /Type /Encoding /Differences [97 /square] >> ` +
          `/FirstChar 97 /LastChar 97 /Widths [8] /Resources << >> >>`,
      ],
      [20, `<< /square 21 0 R >>`],
      [21, `<< /Length ${charProc.length} >>\nstream\n${charProc}\nendstream`],
    ],
  });
})();

/**
 * Struck-through text, in the two shapes a producer actually leaves behind.
 *
 * Page 1 line 1 is the word-processor shape: the struck run is its own text item
 * (its own font resource), and the rectangle covers it exactly, so the reader can
 * mark a whole piece without touching its text. Line 2 is the browser shape: one
 * string for the whole line, with the rectangle over its first half only, which
 * is the case that forces a split.
 *
 * Page 2 puts a strike inside a reconstructed table, where the marker has to
 * survive cell escaping without changing the column count.
 */
const strikeDoc = (() => {
  const before = "Le prix est de ";
  const struck = "cent euros";
  const after = " deux cents euros.";
  const x0 = 72;
  const x1 = x0 + textWidth(before);
  const x2 = x1 + textWidth(struck);

  const partial = "aaaa bbbb cccc dddd";
  const partialY = 670;
  // Half the line: the first two words plus the space that follows them.
  const halfWidth = textWidth("aaaa bbbb ");

  const page1 = [
    contentStream([
      { text: before, x: x0, y: 700 },
      { text: struck, x: x1, y: 700, font: "F2" },
      { text: after, x: x2, y: 700 },
      { text: partial, x: x0, y: partialY },
    ]),
    strikeOver(struck, x1, 700),
    filled(x0, partialY + 0.31 * 12, halfWidth, 0.5),
  ].join("\n");

  const cellX = (c) => 72 + c * 150;
  const page2 = [
    contentStream(
      tableRows.flatMap((row, r) => row.map((cell, c) => ({ text: cell, x: cellX(c), y: 700 - r * 20 }))),
    ),
    strikeOver("South", cellX(0), 700 - 2 * 20),
  ].join("\n");

  return buildPdf([page1, page2], { secondFont: true });
})();

/**
 * Everything drawn like a strike that is not one: an underline under a link, a
 * stroked page rule, a thin filled rectangle sitting well above a line of text,
 * and a table drawn with ruling lines around its cells. Nothing on this page may
 * come back marked.
 */
const strikeDecoyDoc = (() => {
  const link = "Cliquez ici";
  const linkX = 72;
  const linkY = 700;
  const above = "Texte sous une barre lointaine";
  const aboveY = 660;

  // A ruled table: two rows of two cells, boxed and divided. The vertical rules
  // cross the text's own band, and the horizontal ones sit in the row padding —
  // which is where a border sits and a strike does not.
  const gridTop = 520;
  const rowHeight = 24;
  const columns = [72, 240, 400];
  const ruledTable = [
    contentStream([
      { text: "Poste", x: 80, y: gridTop - 16 },
      { text: "Montant", x: 248, y: gridTop - 16 },
      { text: "Total", x: 80, y: gridTop - rowHeight - 16 },
      { text: "1200", x: 248, y: gridTop - rowHeight - 16 },
    ]),
    stroked(columns[0], gridTop, columns[2], gridTop),
    stroked(columns[0], gridTop - rowHeight, columns[2], gridTop - rowHeight),
    stroked(columns[0], gridTop - 2 * rowHeight, columns[2], gridTop - 2 * rowHeight),
    ...columns.map((x) => stroked(x, gridTop, x, gridTop - 2 * rowHeight)),
    // The same table's outer rule, drawn filled rather than stroked, as several
    // producers do: thin, but in the padding rather than across the glyphs.
    filled(columns[0], gridTop - 2 * rowHeight - 1, columns[2] - columns[0], 0.5),
  ].join("\n");

  return buildPdf([
    [
      contentStream([
        { text: link, x: linkX, y: linkY },
        { text: above, x: 72, y: aboveY },
        { text: "Sous le filet de page.", x: 72, y: 560 },
      ]),
      underlineUnder(link, linkX, linkY),
      // 0.8 em above the baseline: too high to be a strike over this line
      filled(72, aboveY + 0.8 * 12, textWidth(above), 0.5),
      stroked(72, 600, 540, 600),
      ruledTable,
    ].join("\n"),
  ]);
})();

/** Cut mid-object: a file that begins like a PDF and is not one. */
const corruptDoc = Buffer.concat([textDoc.subarray(0, 220), Buffer.from("\n%%broken\n", "latin1")]);

const fixtures = {
  "pdf-text.pdf": textDoc,
  "pdf-table.pdf": tableDoc,
  "pdf-mixed.pdf": mixedDoc,
  "pdf-scan.pdf": scanDoc,
  "pdf-mixed-scan.pdf": mixedScanDoc,
  "pdf-long.pdf": longDoc,
  "pdf-strike.pdf": strikeDoc,
  "pdf-strike-underline.pdf": strikeDecoyDoc,
  "pdf-type3.pdf": type3Doc,
  "pdf-encrypted.pdf": encryptedDoc,
  "pdf-corrupt.pdf": corruptDoc,
};

for (const [name, bytes] of Object.entries(fixtures)) {
  await writeFile(path.join(HERE, name), bytes);
  console.log(`${name}: ${bytes.length} bytes`);
}
