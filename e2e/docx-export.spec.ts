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
import { pngBytes } from "../ui/src/export/testImages";

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
async function exportInBrowser(
  page: import("@playwright/test").Page,
  markdown: string,
  path = "doc.md",
  options?: { serverUrl?: string; token?: string | null },
) {
  const base64 = await page.evaluate(
    ([source, name, opts]) => window.__docxExport.build(source, name, opts as never),
    [markdown, path, options] as const,
  );
  return JSZip.loadAsync(Buffer.from(base64, "base64"));
}

/** A figure of the kind the agent writes beside a document it is drafting. */
function figureSvg(label: string): string {
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200" width="100%">',
    '<rect x="10" y="10" width="380" height="180" fill="#dde7ff" stroke="#2244aa"/>',
    `<text x="24" y="60" font-family="sans-serif" font-size="18">${label}</text>`,
    "</svg>",
  ].join("");
}

/**
 * The workspace, as the page can read it.
 *
 * The export fetches a reference through `/files/raw`, which is the server's
 * route; this page has no server behind it, so the route is answered here. The
 * requests are still made, still same-origin, and still recorded — which is what
 * the offline test needs to remain a real assertion rather than a vacuous one.
 */
async function serveWorkspace(
  page: import("@playwright/test").Page,
  files: Record<string, { body: string | Buffer; contentType: string }>,
): Promise<string[]> {
  const asked: string[] = [];
  await page.route("**/files/raw*", async (route) => {
    const path = new URL(route.request().url()).searchParams.get("path") ?? "";
    asked.push(path);
    const file = files[path];
    if (file === undefined) {
      await route.fulfill({ status: 404, contentType: "text/plain", body: "no such file" });
      return;
    }
    await route.fulfill({ status: 200, contentType: file.contentType, body: file.body });
  });
  return asked;
}

/** The media parts of a package, ignoring the folder entry the zip carries. */
function media(zip: JSZip): string[] {
  return Object.keys(zip.files).filter((name) => name.startsWith("word/media/") && !name.endsWith("/"));
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

test("exporting stays on the origin that served the application", async ({ page }) => {
  /*
   * The capability's inputs are the document's text and the workspace files it
   * references — and nothing else. A font, a CDN script or a diagram theme
   * fetched at export time would all break that, and so would reaching for an
   * image somebody wrote an absolute URL to.
   *
   * A document that references a figure is used deliberately: with only text, the
   * assertion would hold for an export that fetched nothing at all, which is no
   * longer what is being claimed.
   */
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await serveWorkspace(page, { "figures/whole.svg": { body: figureSvg("Whole"), contentType: "image/svg+xml" } });

  const zip = await exportInBrowser(page, `${RICH}\n![the whole architecture](figures/whole.svg)\n`, "doc.md", {
    serverUrl: "",
    token: null,
  });

  // Requests were made, and the figure did arrive: otherwise this proves nothing.
  expect(requests.some((url) => url.includes("/files/raw"))).toBe(true);
  expect(media(zip).filter((name) => name.endsWith(".svg"))).toHaveLength(2);

  const offSite = requests.filter((url) => !url.startsWith(HOST) && !url.startsWith("data:") && !url.startsWith("blob:"));
  expect(offSite).toEqual([]);
});

test("a referenced figure is carried as a vector, with a raster behind it", async ({ page }) => {
  // The observation that opened this change: a figure the agent wrote beside a
  // document arrived in Word as the words "The whole architecture".
  await serveWorkspace(page, {
    "figures/whole.svg": { body: figureSvg("The whole architecture"), contentType: "image/svg+xml" },
  });

  const zip = await exportInBrowser(page, "# Report\n\n![The whole architecture](figures/whole.svg)\n", "doc.md", {
    serverUrl: "",
    token: null,
  });

  expect(media(zip).filter((name) => name.endsWith(".svg"))).toHaveLength(1);
  expect(media(zip).filter((name) => name.endsWith(".png"))).toHaveLength(1);

  const document = await partText(zip, "word/document.xml");
  expect(document).toContain("svgBlip");
  // The picture is there instead of the alt text, which is the whole point.
  expect(document).not.toContain("The whole architecture</w:t>");

  // The vector that travels is the figure itself, drawn from the file on disk.
  const svg = await partText(zip, media(zip).find((name) => name.endsWith(".svg"))!);
  expect(svg).toContain("The whole architecture");
});

test("a referenced raster travels as the file it already is", async ({ page }) => {
  const bytes = pngBytes(300, 150);
  await serveWorkspace(page, { "plot.png": { body: Buffer.from(bytes), contentType: "image/png" } });

  const zip = await exportInBrowser(page, "![a plot](plot.png)\n", "doc.md", { serverUrl: "", token: null });

  const parts = media(zip);
  expect(parts).toHaveLength(1);
  expect(parts[0]).toMatch(/\.png$/);
  expect(Buffer.from(await zip.file(parts[0])!.async("uint8array"))).toEqual(Buffer.from(bytes));
});

test("a figure beside the document, below it, and above it all resolve", async ({ page }) => {
  const asked = await serveWorkspace(page, {
    "docs/guide/beside.svg": { body: figureSvg("Beside"), contentType: "image/svg+xml" },
    "docs/guide/figures/below.svg": { body: figureSvg("Below"), contentType: "image/svg+xml" },
    "docs/shared/above.svg": { body: figureSvg("Above"), contentType: "image/svg+xml" },
  });

  const markdown = "![a](beside.svg)\n\n![b](figures/below.svg)\n\n![c](../shared/above.svg)\n";
  const zip = await exportInBrowser(page, markdown, "docs/guide/report.md", { serverUrl: "", token: null });

  // Resolved against the document's own directory, exactly as the viewer resolves
  // them on screen.
  expect(asked).toEqual(["docs/guide/beside.svg", "docs/guide/figures/below.svg", "docs/shared/above.svg"]);
  expect(media(zip).filter((name) => name.endsWith(".svg"))).toHaveLength(3);
});

test("a reference the workspace cannot answer keeps its words and breaks nothing", async ({ page }) => {
  await serveWorkspace(page, {});

  const zip = await exportInBrowser(page, "Before.\n\n![the missing figure](gone.svg)\n\nAfter.\n", "doc.md", {
    serverUrl: "",
    token: null,
  });
  const document = await partText(zip, "word/document.xml");

  expect(media(zip)).toEqual([]);
  expect(document).toContain("the missing figure");
  expect(document).toContain("Before.");
  expect(document).toContain("After.");
});

test("an absolute URL is not fetched, however plausible it looks", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));

  const zip = await exportInBrowser(page, "![a remote chart](https://example.com/x.png)\n", "doc.md", {
    serverUrl: "",
    token: null,
  });
  const document = await partText(zip, "word/document.xml");

  expect(requests.filter((url) => url.includes("example.com"))).toEqual([]);
  expect(media(zip)).toEqual([]);
  expect(document).toContain("a remote chart");
});
