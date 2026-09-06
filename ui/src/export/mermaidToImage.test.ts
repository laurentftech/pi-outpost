import { describe, expect, it, vi } from "vitest";
import { diagramSize } from "./markdownToDocx";
import { buildDocx } from "./docxExport";
import { documentXml, visibleText } from "./testSupport";
import { DiagramError, inlineStyles, rasterise, svgDimensions, withExplicitSize } from "./mermaidToImage";

/**
 * What this file can and cannot prove.
 *
 * jsdom has no 2D canvas context and mermaid cannot measure text in it
 * (`getBBox` does not exist), so a diagram genuinely cannot be drawn here. That is
 * not a gap to paper over with a mock that returns a picture: a fake kinder than
 * reality is exactly how the export would ship with every diagram label blank.
 *
 * So the arithmetic and the failure path are tested here, where they are real, and
 * the drawn picture — the vector, the raster behind it, the labels — is checked in
 * a real browser. See the diagram tests under `e2e/`.
 */

const SVG = '<svg width="100%" height="100%" viewBox="0 0 800 400" style="max-width: 800px;"><text>a</text></svg>';

describe("svgDimensions", () => {
  it("reads the real size from the viewBox, which is where mermaid puts it", () => {
    // The width and height attributes say "100%", so the viewBox is the only place
    // the diagram's own dimensions exist.
    expect(svgDimensions(SVG)).toEqual({ width: 800, height: 400 });
  });

  it("refuses an SVG with no usable viewBox rather than guessing a size", () => {
    expect(() => svgDimensions("<svg><text>a</text></svg>")).toThrow(DiagramError);
    expect(() => svgDimensions('<svg viewBox="0 0 0 0"></svg>')).toThrow(DiagramError);
  });
});

describe("withExplicitSize", () => {
  it("replaces the percentage width that makes a canvas draw nothing", () => {
    const sized = withExplicitSize(SVG, 800, 400);

    expect(sized).toContain('width="800"');
    expect(sized).toContain('height="400"');
    expect(sized).not.toContain('width="100%"');
  });

  it("drops the max-width that would shrink it again", () => {
    expect(withExplicitSize(SVG, 800, 400)).not.toContain("max-width");
  });

  it("sizes the root even when it declares no height of its own", () => {
    // A mermaid root is exactly this: a width of 100%, a viewBox, and no height.
    const root = '<svg width="100%" viewBox="0 0 800 400" style="max-width: 800px;"><rect height="49"/></svg>';

    const sized = withExplicitSize(root, 800, 400);

    expect(/<svg[^>]*\sheight="400"/.test(sized)).toBe(true);
  });

  it("leaves the geometry of the drawing alone", () => {
    /*
     * The regression this exists for. An unanchored replace of the first
     * `height="…"` finds a child's, not the root's, because the root has none —
     * and the first node in every diagram then took the height of the whole
     * drawing and sat on top of the rest of the picture.
     */
    const root =
      '<svg width="100%" viewBox="0 0 149 263">' +
      '<rect x="-57" y="-24.5" width="114" height="49" />' +
      '<rect x="-66" y="-24.5" width="133" height="49" />' +
      "</svg>";

    const sized = withExplicitSize(root, 149, 263);

    // Both children keep the height the layout gave them.
    expect([...sized.matchAll(/<rect[^>]*\sheight="(\d+)"/g)].map((match) => match[1])).toEqual(["49", "49"]);
    expect([...sized.matchAll(/<rect[^>]*\swidth="(\d+)"/g)].map((match) => match[1])).toEqual(["114", "133"]);
  });
});

describe("diagramSize", () => {
  it("leaves a diagram narrower than the text block at its own size", () => {
    expect(diagramSize(400, 300)).toEqual({ width: 400, height: 300 });
  });

  it("clamps a diagram wider than the text block, keeping its proportions", () => {
    // 624 px is the 6.5 inch text block of a Letter page with one-inch margins —
    // 5 943 600 EMU. A picture wider than that runs off the edge of the page.
    const sized = diagramSize(1248, 600);

    expect(sized.width).toBe(624);
    expect(sized.height).toBe(300);
  });

  it("keeps the aspect ratio of a very wide diagram", () => {
    const sized = diagramSize(2000, 500);

    expect(sized.width).toBe(624);
    expect(sized.width / sized.height).toBeCloseTo(4, 1);
  });
});

describe("inlineStyles", () => {
  it("writes the painting properties onto every shape", () => {
    /*
     * The defect this exists for: a mermaid diagram styles its shapes through a
     * stylesheet inside the SVG. A browser runs that CSS, so the picture looks
     * right on screen — and a reader that draws SVG without running CSS paints
     * every shape in the default fill, which is a solid black block.
     *
     * What is asserted here is the mechanism: every shape leaves with its own
     * paint attributes. Whether the *values* are the ones the stylesheet asked for
     * cannot be checked in jsdom, which does not apply a `<style>` inside an SVG
     * and simply hands back defaults — so that half is asserted in a real browser,
     * in `e2e/docx-export.spec.ts`.
     */
    const svg =
      '<svg viewBox="0 0 10 10"><style>.box{fill:rgb(1, 2, 3);stroke:rgb(4, 5, 6)}</style>' +
      '<rect class="box" width="4" height="4"/></svg>';

    const inlined = inlineStyles(svg);

    const rect = /<rect[^>]*>/.exec(inlined)?.[0] ?? "";
    for (const property of ["fill", "stroke", "stroke-width", "opacity"]) {
      expect(rect).toContain(`${property}=`);
    }
  });

  it("removes what the appearance used to depend on", () => {
    const svg = '<svg viewBox="0 0 10 10"><style>.box{fill:rgb(1, 2, 3)}</style><rect class="box"/></svg>';

    const inlined = inlineStyles(svg);

    expect(inlined).not.toContain("<style");
    expect(inlined).not.toContain("class=");
  });

  it("keeps the geometry the layout produced", () => {
    const svg = '<svg viewBox="0 0 10 10"><rect x="1" y="2" width="4" height="6"/></svg>';

    const inlined = inlineStyles(svg);

    expect(inlined).toContain('width="4"');
    expect(inlined).toContain('height="6"');
  });

  it("leaves something that is not an SVG alone rather than throwing", () => {
    expect(inlineStyles("not markup at all")).toBe("not markup at all");
  });

  it("puts nothing permanent into the page it borrows to resolve the styles", () => {
    // Resolving computed styles needs the element laid out in a document. What is
    // borrowed has to be given back, or an export leaves a stray subtree behind it
    // every time it runs.
    const before = document.body.childElementCount;

    inlineStyles('<svg viewBox="0 0 10 10"><rect class="box"/></svg>');

    expect(document.body.childElementCount).toBe(before);
  });
});

describe("rasterise", () => {
  it("reports the reason when the browser will not give it a canvas", async () => {
    // jsdom has no 2D context, which is exactly the shape of a browser that
    // refuses one — and the caller must fall back rather than write a picture
    // that is not there.
    await expect(rasterise(SVG, 800, 400)).rejects.toThrow(DiagramError);
  });

  it("reports the reason when the drawing cannot be turned into an image", async () => {
    // A canvas that will draw but produces no blob: `toBlob` handing back null is
    // a real outcome, and it must not become a zero-byte part in the package.
    const context = { fillStyle: "", fillRect: () => {}, drawImage: () => {} };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => callback(null));
    // jsdom never loads an image, so the load is completed here instead.
    vi.spyOn(window.Image.prototype, "src", "set").mockImplementation(function (this: HTMLImageElement) {
      queueMicrotask(() => this.onload?.(new Event("load")));
    });

    await expect(rasterise(SVG, 8, 4)).rejects.toThrow(DiagramError);

    vi.restoreAllMocks();
  });

  it("reports the reason when the browser refuses to draw the diagram", async () => {
    const context = { fillStyle: "", fillRect: () => {}, drawImage: () => {} };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as unknown as CanvasRenderingContext2D);
    vi.spyOn(window.Image.prototype, "src", "set").mockImplementation(function (this: HTMLImageElement) {
      queueMicrotask(() => this.onerror?.(new Event("error")));
    });

    await expect(rasterise(SVG, 8, 4)).rejects.toThrow(DiagramError);

    vi.restoreAllMocks();
  });
});

describe("a diagram that cannot be drawn", () => {
  // A real render attempt, not a stub: mermaid genuinely tries and fails here, and
  // loading it takes several seconds when the whole suite is competing for the CPU.
  it("falls back to its source, and the export still succeeds", { timeout: 30_000 }, async () => {
    // Not a simulated failure: mermaid really cannot render in this environment,
    // so this exercises the fallback exactly as a broken diagram would.
    const blob = await buildDocx("Before.\n\n```mermaid\ngraph TD; A-->B;\n```\n\nAfter.\n", "doc.md");
    const xml = await documentXml(blob);

    const text = visibleText(xml);
    expect(text).toContain("graph TD; A-->B;");
    // The document around it is untouched.
    expect(text).toContain("Before.");
    expect(text).toContain("After.");
  });

  it("leaves no picture behind referring to a part that is not there", { timeout: 30_000 }, async () => {
    // The failure that makes Word offer to repair a document: a drawing that names
    // a relationship the package does not carry.
    const blob = await buildDocx("```mermaid\ngraph TD; A-->B;\n```\n", "doc.md");
    const xml = await documentXml(blob);

    expect(xml).not.toContain("<w:drawing>");
    expect(xml).not.toContain("<a:blip");
  });
});

describe("the mermaid configuration an export borrows", () => {
  it("puts back what it found, so the page keeps rendering as it did", async () => {
    // `mermaid.initialize()` is global to the module and the viewer's own diagrams
    // share it. An export configures it for a printed page — light theme, no HTML
    // labels — and must hand it back, or the next diagram on screen is drawn with
    // the export's settings.
    const initialize = vi.fn();
    const render = vi.fn().mockRejectedValue(new Error("no dom"));
    vi.doMock("mermaid", () => ({ default: { initialize, render } }));

    const { renderDiagram } = await import("./mermaidToImage");
    await expect(renderDiagram("graph TD; A-->B;", "test-restore")).rejects.toThrow(DiagramError);

    // Configured for export, then restored — the last word is not the export's.
    expect(initialize.mock.calls.length).toBeGreaterThanOrEqual(2);
    const exportCall = initialize.mock.calls[0][0];
    const restoreCall = initialize.mock.calls[initialize.mock.calls.length - 1][0];
    expect(exportCall.htmlLabels).toBe(false);
    expect(exportCall.theme).toBe("default");
    expect(restoreCall.htmlLabels).toBeUndefined();
    expect(restoreCall.theme).toBeUndefined();

    vi.doUnmock("mermaid");
  });

  it("restores the configuration even when a diagram fails", async () => {
    // The `finally` is what makes this true; without it one bad diagram would leave
    // every later on-screen diagram drawn with the export's settings.
    const initialize = vi.fn();
    const render = vi.fn().mockRejectedValue(new Error("boom"));
    vi.doMock("mermaid", () => ({ default: { initialize, render } }));

    const { renderDiagram } = await import("./mermaidToImage");
    await expect(renderDiagram("nonsense", "test-failure")).rejects.toThrow(DiagramError);

    expect(initialize).toHaveBeenCalledTimes(2);
    expect(initialize.mock.calls[1][0].htmlLabels).toBeUndefined();

    vi.doUnmock("mermaid");
  });
});
