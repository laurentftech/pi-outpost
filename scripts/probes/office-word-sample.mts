/**
 * A Word document as the Open WebUI tool will write it — default template, Markdown with
 * Mermaid diagrams and a picture given as a data: URI — to open in Word and look at.
 *
 * Writes <out>/sample.docx, then, when an office application is found (Word on Windows,
 * LibreOffice, ONLYOFFICE), <out>/page-<n>.png of each page as that application draws it.
 * Those pages approximate Word; the .docx itself, opened in desktop Word, is the check.
 *
 *   node --import tsx/esm scripts/probes/office-word-sample.mts [out-dir]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { createDocument } from "@pi-outpost/office/docxBuild.ts";
import { readWordPackage } from "@pi-outpost/office/docxTemplate.ts";
import { defaultWordTemplateBytes } from "@pi-outpost/office/defaultWordTemplate.ts";
import { callPictures } from "@pi-outpost/office/callPictures.ts";
import { createMermaidRenderer } from "@pi-outpost/office/mermaidRender.ts";
import { convertDocumentToPdf, rasterizePdf } from "../../server/src/presentationRender.ts";

const out = path.resolve(process.argv[2] ?? "office-word-sample");
mkdirSync(out, { recursive: true });

const canvas = createRequire(import.meta.url)("@napi-rs/canvas") as {
  createCanvas(width: number, height: number): {
    getContext(kind: "2d"): { fillStyle: string; font: string; fillRect(x: number, y: number, w: number, h: number): void; fillText(text: string, x: number, y: number): void };
    encode(format: "png"): Promise<Buffer>;
  };
};
const surface = canvas.createCanvas(360, 120);
const context = surface.getContext("2d");
context.fillStyle = "#2f5496";
context.fillRect(0, 0, 360, 120);
context.fillStyle = "#ffffff";
context.font = "bold 36px sans-serif";
context.fillText("pi-outpost", 70, 72);
const logo = `data:image/png;base64,${(await surface.encode("png")).toString("base64")}`;

const markdown = `# Rollout of the office tools

This document was written by the Open WebUI tool server from one call: no browser, no office application.

## What ships

- a Word document from Markdown, in a template's styles;
- a PowerPoint deck from slides;
- diagrams drawn as pictures: structured exchange and **Mermaid**.

| Part | Owner | State |
| --- | --- | --- |
| Builders package | Laurent | done |
| Mermaid renderer | Laurent | done |
| Routes | Laurent | next |

## How a request flows

\`\`\`mermaid
flowchart LR
  A[Model calls create_document] --> B{Diagrams valid?}
  B -->|yes| C[Build the .docx]
  B -->|no| D[Refuse with the reasons]
  D --> A
  C --> E((Download in the chat))
\`\`\`

## Who talks to whom

\`\`\`mermaid
sequenceDiagram
  participant U as User
  participant M as Model
  participant S as Tool server
  U->>M: Write me the report
  M->>S: create_document
  S-->>M: embed with the file
  M-->>U: Here is your report
\`\`\`

## A picture given in the call

![The pi-outpost banner](${logo})

That banner travelled inside the call as a data: URI.
`;

const mermaid = createMermaidRenderer();
const pictures = callPictures({ mermaid });
try {
  const { bytes, warnings } = await createDocument(readWordPackage(defaultWordTemplateBytes()), markdown, { pictures: pictures.source });
  const file = path.join(out, "sample.docx");
  writeFileSync(file, bytes);
  console.log(JSON.stringify({ file, bytes: bytes.length, warnings, refusals: pictures.refusals() }, null, 2));

  try {
    const { pdf, renderer } = await convertDocumentToPdf(file, { renderer: "auto", timeoutMs: 120_000 });
    writeFileSync(path.join(out, "sample.pdf"), pdf);
    const pages = await rasterizePdf(pdf, [1, 2, 3, 4], 1100);
    for (const page of pages?.images ?? []) writeFileSync(path.join(out, `page-${page.page}.png`), page.png);
    console.log(`drawn by ${renderer}: ${pages?.pageCount ?? 0} page(s)`);
  } catch (error) {
    console.log(`no office application drew it: ${error instanceof Error ? error.message : String(error)}`);
  }
} finally {
  await mermaid.close();
}
