/**
 * Mermaid drawn without a browser, through `@pi-outpost/office`'s renderer: the gate of
 * the openwebui-office-documents change (tasks 2.3).
 *
 * Renders each diagram kind the gate names, and writes, per kind, into the output folder:
 *   <kind>.svg         the vector that goes into the file (styles written onto elements)
 *   <kind>.png         the raster behind it (resvg, from Mermaid's styled SVG)
 *   <kind>-chrome.png  the vector as headless Chrome draws it, when Chrome is found
 *
 * Look at all three: the vector is what Word 2016+ shows, the raster what LibreOffice,
 * Google Docs and older Office show.
 *
 *   node --import tsx/esm scripts/probes/mermaid-node.mts [out-dir]
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createMermaidRenderer } from "@pi-outpost/office/mermaidRender.ts";

const out = path.resolve(process.argv[2] ?? "mermaid-node-out");
mkdirSync(out, { recursive: true });

const DIAGRAMS: Record<string, string> = {
  flowchart: [
    "flowchart LR",
    "  A[Start] --> B{Is the request clear?}",
    "  B -->|yes| C[Write the document]",
    "  B -->|no| D[Ask a question]",
    "  D --> A",
    "  C --> E((Done))",
  ].join("\n"),
  sequence: [
    "sequenceDiagram",
    "  participant U as User",
    "  participant S as Tool server",
    "  U->>S: create_document",
    "  S-->>U: the embed, with a download",
    "  Note over U,S: nothing is stored",
  ].join("\n"),
  gantt: [
    "gantt",
    "  title Rollout",
    "  dateFormat YYYY-MM-DD",
    "  section Build",
    "  Package      :a1, 2026-10-12, 4d",
    "  Routes       :a2, after a1, 3d",
    "  section Ship",
    "  Live run     :after a2, 2d",
  ].join("\n"),
  pie: ['pie title Where the time goes', '  "Writing" : 45', '  "Diagrams" : 30', '  "Review" : 25'].join("\n"),
  class: [
    "classDiagram",
    "  class Document {",
    "    +string fileName",
    "    +render() Buffer",
    "  }",
    "  class Presentation",
    "  Document <|-- Presentation",
  ].join("\n"),
};

const CHROME = ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find((candidate) => existsSync(candidate));

const renderer = createMermaidRenderer({ font: process.env.MERMAID_FONT });
const report: Record<string, unknown> = {};
for (const [kind, source] of Object.entries(DIAGRAMS)) {
  const started = Date.now();
  try {
    const image = await renderer.render(source);
    writeFileSync(path.join(out, `${kind}.svg`), image.svg);
    writeFileSync(path.join(out, `${kind}.png`), image.png);
    if (CHROME !== undefined) {
      execFileSync(CHROME, [
        "--headless=new",
        "--disable-gpu",
        "--hide-scrollbars",
        `--window-size=${Math.ceil(image.width) + 16},${Math.ceil(image.height) + 16}`,
        "--force-device-scale-factor=2",
        `--screenshot=${path.join(out, `${kind}-chrome.png`)}`,
        pathToFileURL(path.join(out, `${kind}.svg`)).href,
      ], { stdio: "ignore" });
    }
    report[kind] = { ok: true, width: image.width, height: image.height, svgBytes: image.svg.length, pngBytes: image.png.length, ms: Date.now() - started };
  } catch (error) {
    report[kind] = { ok: false, error: error instanceof Error ? error.message : String(error), ms: Date.now() - started };
  }
}
try {
  await renderer.render("flowchart LR\n  A --> ");
  report.invalid = { refused: false };
} catch (error) {
  report.invalid = { refused: true, message: error instanceof Error ? error.message.split("\n")[0] : String(error) };
}
await renderer.close();
writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
