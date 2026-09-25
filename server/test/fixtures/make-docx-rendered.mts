/**
 * Writes a document from `docx-template.dotx` and the PDF LibreOffice draws of it, the
 * pair the Word rendering tests read. The PDF is checked in because CI has no office
 * application: what is tested there is our reading of a real renderer's output.
 *
 * The document has two chapters (so the PDF's outline has two top-level bookmarks,
 * numbered by the template) and one paragraph formatted as hidden text: it is in the
 * body, and no page shows it — what the text check exists to report.
 *
 *   node --import tsx server/test/fixtures/make-docx-rendered.mts   (needs LibreOffice)
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDocument } from "../../src/docxBuild.ts";
import { readWordPackage } from "../../src/docxTemplate.ts";
import { convertDocumentToPdf, DEFAULT_RENDER_TIMEOUT_MS } from "../../src/presentationRender.ts";
import { readAllZipEntries } from "../../src/zip.ts";
import { writeZip } from "../../src/zipWriter.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const HIDDEN_TEXT = "This sentence is hidden text and appears on no page.";

const template = readWordPackage(await readFile(path.join(HERE, "docx-template.dotx")));
const created = await createDocument(template, "# Findings\n\nThe first chapter.\n\n## Detail\n\nA section.\n\n# Next steps\n\nThe second chapter.\n");
const parts = readAllZipEntries(created.bytes, { maxEntries: 999, maxInflatedBytes: 1e8, maxTotalBytes: 1e9 });
const documentXml = parts.get("word/document.xml")!.toString("utf8");
const hidden = `<w:p><w:r><w:rPr><w:vanish/></w:rPr><w:t>${HIDDEN_TEXT}</w:t></w:r></w:p>`;
parts.set("word/document.xml", Buffer.from(documentXml.replace(/<w:sectPr\b/, `${hidden}<w:sectPr`), "utf8"));
const docx = path.join(HERE, "docx-rendered.docx");
await writeFile(docx, writeZip([...parts].map(([name, data]) => ({ name, data }))));
const conversion = await convertDocumentToPdf(docx, { renderer: "libreoffice", timeoutMs: DEFAULT_RENDER_TIMEOUT_MS });
await writeFile(path.join(HERE, "docx-rendered.pdf"), conversion.pdf);
console.log("wrote docx-rendered.docx and docx-rendered.pdf");
