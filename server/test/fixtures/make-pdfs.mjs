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

/** `[{ text, x, y, size? }]` → a content stream drawing each string at its point. */
function contentStream(items) {
  return items
    .map(({ text, x, y, size = 12 }) => `BT /F1 ${size} Tf ${x} ${y} Td (${escapeText(text)}) Tj ET`)
    .join("\n");
}

function escapeText(text) {
  return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

/**
 * Assemble a PDF from page content streams. `extra` adds trailer entries (used to
 * fake an encrypted document).
 */
function buildPdf(pages, { trailerExtra = "", objectsExtra = [] } = {}) {
  const objects = [];
  const pageIds = pages.map((_, i) => 4 + i * 2);
  objects[1] = `<< /Type /Catalog /Pages 2 0 R >>`;
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  objects[3] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`;

  pages.forEach((content, i) => {
    const pageId = pageIds[i];
    const contentId = pageId + 1;
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ` +
      `/Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`;
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

/** Cut mid-object: a file that begins like a PDF and is not one. */
const corruptDoc = Buffer.concat([textDoc.subarray(0, 220), Buffer.from("\n%%broken\n", "latin1")]);

const fixtures = {
  "pdf-text.pdf": textDoc,
  "pdf-table.pdf": tableDoc,
  "pdf-mixed.pdf": mixedDoc,
  "pdf-scan.pdf": scanDoc,
  "pdf-mixed-scan.pdf": mixedScanDoc,
  "pdf-long.pdf": longDoc,
  "pdf-encrypted.pdf": encryptedDoc,
  "pdf-corrupt.pdf": corruptDoc,
};

for (const [name, bytes] of Object.entries(fixtures)) {
  await writeFile(path.join(HERE, name), bytes);
  console.log(`${name}: ${bytes.length} bytes`);
}
