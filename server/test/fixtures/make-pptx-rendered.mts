/**
 * Builds a deck from `pptx-template.potx` and the PDF LibreOffice draws of it, the pair
 * the rendering tests read. The PDF is checked in because CI has no office application:
 * what is tested there is our reading of a real renderer's output, not the renderer.
 *
 * Slide 3 holds sixteen long paragraphs, of which LibreOffice draws the first five —
 * the rest run off the slide and are clipped out of the PDF, which is the overflow the
 * text check exists to report.
 *
 *   node --import tsx server/test/fixtures/make-pptx-rendered.mts   (needs LibreOffice)
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readImageInfo } from "../../src/imageInfo.ts";
import { buildPresentation, readTemplate } from "../../src/pptxBuild.ts";
import { convertPresentationToPdf, DEFAULT_RENDER_TIMEOUT_MS, rasterizeSvg } from "../../src/presentationRender.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const svg = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200"><rect width="400" height="200" fill="#2563EB"/>' +
    '<text x="40" y="120" font-size="60" fill="#fff" font-family="Arial">Diagram</text></svg>',
);

const template = readTemplate(await readFile(path.join(HERE, "pptx-template.potx")));
const built = await buildPresentation(
  template,
  [
    { title: "Fixture deck", subtitle: "Rendered by LibreOffice" },
    { title: "Fits", bullets: ["One short point", "  a detail", "Another point"] },
    { title: "Overflows", bullets: Array.from({ length: 16 }, (_, i) => `Paragraph ${i + 1} is long enough to wrap onto a second line of the box`) },
    { title: "Picture", bullets: ["Beside it"], image: { name: "diagram.svg", bytes: svg, info: readImageInfo(svg, "diagram.svg"), alt: "diagram" } },
  ],
  { rasterizeSvg },
);
const deck = path.join(HERE, "pptx-rendered.pptx");
await writeFile(deck, built.bytes);
const conversion = await convertPresentationToPdf(deck, { renderer: "libreoffice", timeoutMs: DEFAULT_RENDER_TIMEOUT_MS });
await writeFile(path.join(HERE, "pptx-rendered.pdf"), conversion.pdf);
console.log("wrote pptx-rendered.pptx and pptx-rendered.pdf");
