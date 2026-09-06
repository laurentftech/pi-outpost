/**
 * The Word export, in a real browser.
 *
 * Everything here is something the unit tests genuinely cannot check. jsdom has no
 * 2D canvas context and mermaid cannot measure text in it, so a diagram is never
 * drawn, never rasterised, and never embedded there. Mocking those would be worse
 * than not testing them: a fake kinder than reality is exactly how this ships with
 * every diagram label blank.
 *
 * So the export runs in Chromium and the bytes come back to be opened here.
 */
import { expect, test } from "@playwright/test";
import JSZip from "jszip";

const HOST = process.env.PI_E2E_HOST_URL ?? "";

/** A document exercising every construct the export claims to carry. */
const RICH = [
  "# Architecture",
  "",
  "The **battery** feeds the *controller* over a $400\\,\\mathrm{V}$ bus.",
  "",
  "$$",
  "\\frac{P}{V} = I",
  "$$",
  "",
  "```mermaid",
  "graph TD;",
  "  Battery-->Controller;",
  "  Controller-->Motor;",
  "```",
  "",
  "| Part | Voltage |",
  "| ---- | ------- |",
  "| Battery | 400 |",
  "| Motor | 400 |",
  "",
  "1. Charge",
  "2. Drive",
  "",
].join("\n");

/** Runs the export in the page and opens the package here. */
async function exportInBrowser(page: import("@playwright/test").Page, markdown: string, path = "doc.md") {
  const base64 = await page.evaluate(
    ([source, name]) => window.__docxExport.build(source, name),
    [markdown, path] as const,
  );
  return JSZip.loadAsync(Buffer.from(base64, "base64"));
}

async function partText(zip: JSZip, name: string): Promise<string> {
  const file = zip.file(name);
  if (file === null) throw new Error(`no part ${name}; package has: ${Object.keys(zip.files).join(", ")}`);
  return file.async("string");
}

test.beforeEach(async ({ page }) => {
  await page.goto(`${HOST}/export.html`);
  await expect(page.locator("#ready")).toHaveText("harness ready");
});

test("a diagram is embedded as a vector with a raster behind it", async ({ page }) => {
  const zip = await exportInBrowser(page, RICH);

  const media = Object.keys(zip.files).filter((name) => name.startsWith("word/media/"));
  const svg = media.filter((name) => name.endsWith(".svg"));
  const png = media.filter((name) => name.endsWith(".png"));

  // Both, not either: Word draws the vector, and everything else draws the raster
  // rather than a broken image.
  expect(svg).toHaveLength(1);
  expect(png).toHaveLength(1);

  const document = await partText(zip, "word/document.xml");
  // The picture refers to the raster as its blip, and names the vector through the
  // Office SVG extension beside it.
  expect(document).toContain("<a:blip");
  expect(document).toContain("svgBlip");
});

test("a reader without SVG support is pointed at the raster, not at nothing", async ({ page }) => {
  /*
   * The fallback mechanism, asserted precisely rather than assumed.
   *
   * A picture names one blip and may carry an extension beside it. A reader that
   * knows the Office SVG extension follows it to the vector; a reader that does
   * not ignores the extension it does not recognise and draws the blip. So the
   * blip must be the *raster*: if the two were the other way round, Word would
   * look perfect and every other reader would show a broken image.
   */
  const zip = await exportInBrowser(page, RICH);
  const document = await partText(zip, "word/document.xml");
  const rels = await partText(zip, "word/_rels/document.xml.rels");

  const blip = /<a:blip[\s\S]*?<\/a:blip>/.exec(document)![0];
  const target = (id: string) => new RegExp(`Id="${id}"[^>]*Target="([^"]+)"`).exec(rels)?.[1] ?? "";

  const primary = /r:embed="([^"]+)"/.exec(blip)![1];
  expect(target(primary)).toMatch(/\.png$/);

  // The documented GUID for the Office SVG extension.
  expect(blip).toContain("{96DAC541-7B7A-43D3-8B79-37D633B846F1}");
  const vector = /svgBlip[^>]*r:embed="([^"]+)"/.exec(blip)![1];
  expect(target(vector)).toMatch(/\.svg$/);
});

test("the diagram's labels are drawn, not blank", async ({ page }) => {
  // The defect this test exists for: mermaid draws flowchart labels in a
  // `foreignObject` unless told otherwise, and a `foreignObject` does not render
  // when an SVG is drawn through an `<img>`. The export would look perfect until
  // someone opened it and found every box empty.
  const zip = await exportInBrowser(page, RICH);
  const svgName = Object.keys(zip.files).find((name) => name.endsWith(".svg"))!;
  const svg = await partText(zip, svgName);

  expect(svg).not.toContain("foreignObject");
  expect(svg).toContain("<text");
  for (const label of ["Battery", "Controller", "Motor"]) {
    expect(svg).toContain(label);
  }
});

test("the embedded vector carries its own appearance, not a stylesheet", async ({ page }) => {
  /*
   * Found by opening a real export in LibreOffice: it supports enough of the SVG
   * extension to use the vector and not enough to run the CSS inside it, so every
   * shape fell back to the default fill and the diagram arrived as a solid black
   * block. The raster fallback never came into it — the reader had already chosen
   * the vector.
   *
   * A diagram is therefore only portable if it depends on no stylesheet at all.
   */
  const zip = await exportInBrowser(page, RICH);
  const svgName = Object.keys(zip.files).find((name) => name.endsWith(".svg"))!;
  const svg = await partText(zip, svgName);

  // Nothing left to apply, and nothing left to apply it to.
  expect(svg).not.toContain("<style");
  expect(svg).not.toContain("class=");

  // The appearance is on the shapes themselves. Black-only would be the very
  // failure this guards against, so a non-black fill has to be present.
  expect(svg).toMatch(/<(rect|path|circle|polygon)[^>]*\sfill="/);
  const fills = [...svg.matchAll(/fill="([^"]+)"/g)].map((match) => match[1]);
  expect(fills.length).toBeGreaterThan(5);
  expect(fills.some((fill) => fill !== "none" && !/^(#000000|rgb\(0, 0, 0\)|black)$/.test(fill))).toBe(true);
});

test("the embedded picture carries a real size, within the text width", async ({ page }) => {
  const zip = await exportInBrowser(page, RICH);
  const document = await partText(zip, "word/document.xml");

  const extent = /<wp:extent cx="(\d+)" cy="(\d+)"/.exec(document);
  expect(extent).not.toBeNull();
  const [cx, cy] = [Number(extent![1]), Number(extent![2])];
  expect(cx).toBeGreaterThan(0);
  expect(cy).toBeGreaterThan(0);
  // 6.5 inches — the text block of a Letter page with one-inch margins.
  expect(cx).toBeLessThanOrEqual(5_943_600);
});

test("the raster fallback is a real PNG with pixels in it", async ({ page }) => {
  const zip = await exportInBrowser(page, RICH);
  const pngName = Object.keys(zip.files).find((name) => name.endsWith(".png"))!;
  const bytes = await zip.file(pngName)!.async("uint8array");

  // The PNG signature, and enough bytes that it is not a blank 1x1 placeholder.
  expect([...bytes.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  expect(bytes.byteLength).toBeGreaterThan(1000);
});

test("the whole document survives the round trip with its structure intact", async ({ page }) => {
  const zip = await exportInBrowser(page, RICH);
  const document = await partText(zip, "word/document.xml");

  expect(document).toContain('w:val="Heading1"');
  expect(document).toContain("<w:tbl>");
  expect(document).toContain("<w:numPr>");
  expect(document).toContain("<m:oMath>");
  expect(document).toContain("<w:b/>");
  expect(document).toContain("<w:drawing>");
});

test("every relationship the package declares resolves to a part it contains", async ({ page }) => {
  // The defect that makes Word report a document as damaged. With an image in the
  // package there are relationships that the unit tests never exercise.
  const zip = await exportInBrowser(page, RICH);
  const names = new Set(Object.keys(zip.files));
  const faults: string[] = [];

  for (const name of names) {
    if (!name.endsWith(".rels")) continue;
    const base = name.slice(0, name.indexOf("_rels/"));
    for (const match of (await partText(zip, name)).matchAll(/<Relationship\b[^>]*>/g)) {
      if (/TargetMode="External"/.test(match[0])) continue;
      const target = /Target="([^"]+)"/.exec(match[0])?.[1];
      if (target === undefined) continue;
      const resolved = target.startsWith("/") ? target.slice(1) : normalise(base + target);
      if (!names.has(resolved)) faults.push(`${name} -> ${resolved}`);
    }
  }

  expect(faults).toEqual([]);
});

function normalise(path: string): string {
  const parts: string[] = [];
  for (const segment of path.split("/")) {
    if (segment === "." || segment === "") continue;
    if (segment === "..") parts.pop();
    else parts.push(segment);
  }
  return parts.join("/");
}

test("a diagram that cannot be drawn falls back without breaking the package", async ({ page }) => {
  const zip = await exportInBrowser(page, "Before.\n\n```mermaid\nnot a real diagram at all\n```\n\nAfter.\n");
  const document = await partText(zip, "word/document.xml");

  // No picture, no dangling relationship, and the source is still readable.
  expect(document).not.toContain("<w:drawing>");
  expect(document).toContain("not a real diagram at all");
  expect(document).toContain("Before.");
  expect(document).toContain("After.");
});

test("a large document exports without hanging the page", async ({ page }) => {
  // Twelve hundred paragraphs with equations and a table throughout — far past any
  // note someone would write, and the interface has to survive it.
  const large = Array.from(
    { length: 400 },
    (_, index) => `## Section ${index}\n\nParagraph with $x_{${index}}^2$ inline.\n\n- one\n- two\n`,
  ).join("\n");

  const zip = await exportInBrowser(page, large);
  const document = await partText(zip, "word/document.xml");

  expect(document).toContain('w:val="Heading2"');
  expect([...document.matchAll(/<m:oMath>/g)].length).toBe(400);

  // The page is still answering afterwards, which is the actual claim.
  await expect(page.locator("#ready")).toHaveText("harness ready");
  const duration = await page.evaluate(() => window.__docxExport.lastDurationMs);
  expect(duration).toBeLessThan(20_000);
});

test("exporting reaches the network for nothing", async ({ page }) => {
  // The capability says the document's own text is the only input. A font, a CDN
  // script or a diagram theme fetched at export time would all break that.
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));

  await exportInBrowser(page, RICH);

  const offSite = requests.filter((url) => !url.startsWith(HOST) && !url.startsWith("data:") && !url.startsWith("blob:"));
  expect(offSite).toEqual([]);
});
