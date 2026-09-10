/**
 * A figure the document points at, carried into the package.
 *
 * What can honestly be proved here is the raster half and every failure: jsdom has
 * no 2D canvas context, so a referenced *vector* cannot be rasterised in this
 * environment any more than a mermaid diagram can, and asserting on a mocked
 * canvas would prove nothing about what a reader opens. The vector path is checked
 * in a real browser — see `e2e/docx-export.spec.ts`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildDocx } from "./docxExport";
import { openDocx, packageFaults, partText, visibleText } from "./testSupport";
import { pngBytes } from "./testImages";

afterEach(() => {
  vi.unstubAllGlobals();
});

/** How the writer converts a pixel to a physical size, at 96 dpi. */
const EMU_PER_PX = 9525;

/** 6.5 inches: the text block of a Letter page with one-inch margins. */
const TEXT_WIDTH_PX = 624;

/** A server that answers with these bytes for any path it knows, and 404s the rest. */
function serving(files: Record<string, Uint8Array>) {
  return vi.fn(async (url: string) => {
    const path = decodeURIComponent(new URL(url, "http://server").searchParams.get("path") ?? "");
    const bytes = files[path];
    if (bytes === undefined) return { ok: false, status: 404 };
    return {
      ok: true,
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    };
  });
}

/** Every media part in the package, by name. */
async function mediaNames(blob: Blob): Promise<string[]> {
  const zip = await openDocx(blob);
  return Object.keys(zip.files).filter((name) => name.startsWith("word/media/") && !name.endsWith("/"));
}

/** Each `<wp:extent>` in the document, as the pixel size it was drawn at. */
function drawnSizes(xml: string): { width: number; height: number }[] {
  return [...xml.matchAll(/<wp:extent cx="(\d+)" cy="(\d+)"/g)].map((match) => ({
    width: Number(match[1]) / EMU_PER_PX,
    height: Number(match[2]) / EMU_PER_PX,
  }));
}

describe("a referenced picture in the package", () => {
  it("carries the referenced file's own bytes, as its own format", async () => {
    const bytes = pngBytes(120, 60);
    vi.stubGlobal("fetch", serving({ "docs/figures/plot.png": bytes }));

    const blob = await buildDocx("![a plot](figures/plot.png)\n", "docs/report.md", { serverUrl: "", token: null });

    const media = await mediaNames(blob);
    expect(media).toHaveLength(1);
    expect(media[0]).toMatch(/\.png$/);
    const zip = await openDocx(blob);
    // Byte for byte: a raster travels as itself and is never redrawn.
    expect(await zip.file(media[0])!.async("uint8array")).toEqual(bytes);
  });

  it("draws it at the size its own pixels imply", async () => {
    vi.stubGlobal("fetch", serving({ "figures/plot.png": pngBytes(120, 60) }));

    const blob = await buildDocx("![a plot](figures/plot.png)\n", "report.md", { serverUrl: "", token: null });

    expect(drawnSizes(await partText(await openDocx(blob), "word/document.xml"))).toEqual([{ width: 120, height: 60 }]);
  });

  it("shows the picture instead of the words that stood in for it", async () => {
    vi.stubGlobal("fetch", serving({ "figures/plot.png": pngBytes(120, 60) }));

    const xml = await partText(
      await openDocx(await buildDocx("![a plot of the load](figures/plot.png)\n", "report.md", { serverUrl: "", token: null })),
      "word/document.xml",
    );

    expect(xml).toContain("<w:drawing>");
    expect(visibleText(xml)).not.toContain("a plot of the load");
  });

  it("keeps a picture wider than the page inside the text block, at its own proportions", async () => {
    // Otherwise the right-hand side of the figure is off the page, which is the
    // one failure a reader cannot work around.
    vi.stubGlobal("fetch", serving({ "wide.png": pngBytes(2000, 500) }));

    const blob = await buildDocx("![wide](wide.png)\n", "report.md", { serverUrl: "", token: null });

    const [size] = drawnSizes(await partText(await openDocx(blob), "word/document.xml"));
    expect(size.width).toBe(TEXT_WIDTH_PX);
    expect(size.width / size.height).toBeCloseTo(2000 / 500, 5);
  });

  it("resolves each reference against the document's own directory", async () => {
    // Beside the document, below it, and above it — the three shapes the viewer
    // resolves on screen, resolved here the same way and in one export.
    const fetched = serving({
      "docs/guide/beside.png": pngBytes(10, 10),
      "docs/guide/figures/below.png": pngBytes(20, 20),
      "docs/shared/above.png": pngBytes(30, 30),
    });
    vi.stubGlobal("fetch", fetched);

    const markdown = "![a](beside.png)\n\n![b](figures/below.png)\n\n![c](../shared/above.png)\n";
    const blob = await buildDocx(markdown, "docs/guide/report.md", { serverUrl: "", token: null });

    expect(await mediaNames(blob)).toHaveLength(3);
    expect(drawnSizes(await partText(await openDocx(blob), "word/document.xml"))).toEqual([
      { width: 10, height: 10 },
      { width: 20, height: 20 },
      { width: 30, height: 30 },
    ]);
  });

  it("asks for a file once however many times the document mentions it", async () => {
    const fetched = serving({ "figures/plot.png": pngBytes(40, 20) });
    vi.stubGlobal("fetch", fetched);

    const markdown = "![the load](figures/plot.png)\n\n![the same plot again](figures/plot.png)\n";
    const blob = await buildDocx(markdown, "report.md", { serverUrl: "", token: null });

    expect(fetched).toHaveBeenCalledTimes(1);
    // One fetch, two pictures: the nodes are separate references with separate
    // alt texts, and both must be drawn.
    expect([...(await partText(await openDocx(blob), "word/document.xml")).matchAll(/<w:drawing>/g)]).toHaveLength(2);
  });
});

describe("a reference the export cannot obtain", () => {
  const CASES: [string, () => unknown][] = [
    ["a file that is not there", () => serving({})],
    ["a path the server refuses", () => vi.fn(async () => ({ ok: false, status: 403 }))],
    ["a payload that is not an image", () => vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => new TextEncoder().encode("<!doctype html><p>not an image</p>").buffer,
    }))],
    ["a server that cannot be reached", () => vi.fn(async () => { throw new TypeError("Failed to fetch"); })],
  ];

  for (const [what, stub] of CASES) {
    it(`falls back to the alt text for ${what}, and carries the rest of the document`, async () => {
      vi.stubGlobal("fetch", stub());

      const markdown = "# Report\n\nBefore.\n\n![the whole architecture](figures/whole.svg)\n\nAfter.\n";
      const blob = await buildDocx(markdown, "report.md", { serverUrl: "", token: null });
      const xml = await partText(await openDocx(blob), "word/document.xml");

      const text = visibleText(xml);
      expect(text).toContain("the whole architecture");
      expect(text).toContain("Before.");
      expect(text).toContain("After.");
      expect(xml).toContain('w:val="Heading1"');
      expect(xml).not.toContain("<w:drawing>");
    });
  }

  it("leaves a package with no relationship pointing at a part it does not contain", async () => {
    // The defect that makes Word offer to repair the document. A picture that was
    // never obtained must leave no trace at all — not an empty part, not a
    // dangling relationship.
    vi.stubGlobal("fetch", serving({}));

    const markdown = "![one](a.png)\n\n![two](b.png)\n\n![three](figures/c.svg)\n";
    const blob = await buildDocx(markdown, "report.md", { serverUrl: "", token: null });

    expect(await packageFaults(blob)).toEqual([]);
    expect(await mediaNames(blob)).toEqual([]);
  });

  it("does not reach off the origin for an absolute reference, and keeps its words", async () => {
    const fetched = vi.fn();
    vi.stubGlobal("fetch", fetched);

    const markdown = "![a remote chart](https://example.com/x.png)\n\n![data](data:image/png;base64,AAAA)\n";
    const xml = await partText(
      await openDocx(await buildDocx(markdown, "report.md", { serverUrl: "", token: null })),
      "word/document.xml",
    );

    expect(fetched).not.toHaveBeenCalled();
    expect(visibleText(xml)).toContain("a remote chart");
    expect(visibleText(xml)).toContain("data");
  });
});
