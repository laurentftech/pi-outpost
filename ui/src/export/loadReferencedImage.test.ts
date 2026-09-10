import { afterEach, describe, expect, it, vi } from "vitest";
import {
  decodeReference,
  isLoadableReference,
  loadReference,
  rasterHeader,
  referenceUrl,
  svgSize,
} from "./loadReferencedImage";
import { rawFileUrl, resolveRelativeHref } from "../util/workspacePath";
import { bmpHeaderBytes, gifHeaderBytes, jpegHeaderBytes, pngBytes, svgSource } from "./testImages";

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A response the loader will accept, carrying these bytes. */
function served(bytes: Uint8Array) {
  return {
    ok: true,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
}

describe("isLoadableReference", () => {
  it("takes a workspace reference in any of the shapes a document writes one", () => {
    // Beside the document, below it, above it, and from the workspace root: all
    // four are files the viewer draws, so all four are files the export carries.
    expect(isLoadableReference("diagram.svg")).toBe(true);
    expect(isLoadableReference("figures/whole.svg")).toBe(true);
    expect(isLoadableReference("../shared/figure.svg")).toBe(true);
    expect(isLoadableReference("/docs/image.png")).toBe(true);
  });

  it("refuses anything that would reach off the origin", () => {
    // The requirement that keeps the export offline, decided from the URL alone —
    // before there is any request to be made, let alone declined.
    expect(isLoadableReference("https://example.com/image.png")).toBe(false);
    expect(isLoadableReference("http://example.com/image.png")).toBe(false);
    expect(isLoadableReference("data:image/png;base64,abc123")).toBe(false);
    expect(isLoadableReference("//example.com/image.png")).toBe(false);
  });

  it("refuses an empty reference, which names no file at all", () => {
    expect(isLoadableReference("")).toBe(false);
  });
});

describe("referenceUrl", () => {
  it("builds the URL the viewer builds for the same document and reference", () => {
    /*
     * The seam this whole change rests on: `WhatTheViewerShowsIsWhatTheExportCarries`.
     *
     * The viewer's `img` resolves `src` against the file's directory and reads it
     * through `/files/raw`. Asserted twice over — against the two helpers the
     * viewer itself calls, and against the literal string, so that a change to
     * either helper cannot quietly move both sides of the comparison together.
     */
    const url = referenceUrl("docs/report.md", "figures/whole.svg", "http://localhost:3141", "t0ken");

    expect(url).toBe(rawFileUrl("http://localhost:3141", resolveRelativeHref("docs/report.md", "figures/whole.svg"), "t0ken"));
    expect(url).toBe("http://localhost:3141/files/raw?path=docs%2Ffigures%2Fwhole.svg&token=t0ken");
  });

  it("resolves against the document's own directory, up as well as down", () => {
    expect(referenceUrl("docs/guide/report.md", "diagram.svg", "", null)).toBe("/files/raw?path=docs%2Fguide%2Fdiagram.svg");
    expect(referenceUrl("docs/guide/report.md", "../shared/figure.svg", "", null)).toBe("/files/raw?path=docs%2Fshared%2Ffigure.svg");
    expect(referenceUrl("docs/guide/report.md", "/logo.png", "", null)).toBe("/files/raw?path=logo.png");
  });

  it("has no URL for a reference it will not fetch", () => {
    expect(referenceUrl("docs/report.md", "https://example.com/x.png", "", null)).toBeUndefined();
    expect(referenceUrl("docs/report.md", "//example.com/x.png", "", null)).toBeUndefined();
  });
});

describe("loadReference", () => {
  it("fetches an eligible reference and reports the picture it found", async () => {
    const bytes = pngBytes(120, 60);
    const fetched = vi.fn().mockResolvedValue(served(bytes));
    vi.stubGlobal("fetch", fetched);

    const picture = await loadReference("docs/report.md", "figures/plot.png", "http://localhost:3141", "t0ken");

    expect(fetched).toHaveBeenCalledWith("http://localhost:3141/files/raw?path=docs%2Ffigures%2Fplot.png&token=t0ken");
    expect(picture).toEqual({ kind: "raster", type: "png", width: 120, height: 60, bytes });
  });

  it("never asks for a reference that points off the origin", async () => {
    const fetched = vi.fn();
    vi.stubGlobal("fetch", fetched);

    expect(await loadReference("docs/report.md", "https://example.com/x.png", "", null)).toBeUndefined();
    expect(await loadReference("docs/report.md", "data:image/png;base64,AAAA", "", null)).toBeUndefined();
    expect(fetched).not.toHaveBeenCalled();
  });

  it("reports no picture when the file is gone or the path is refused", async () => {
    for (const status of [404, 403]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status }));
      expect(await loadReference("docs/report.md", "missing.png", "", null)).toBeUndefined();
    }
  });

  it("reports no picture when the request itself fails", async () => {
    // The server stopped, the connection dropped: the document is worth more than
    // the picture, so this cannot be allowed to reach the caller as a rejection.
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    expect(await loadReference("docs/report.md", "figures/plot.png", "", null)).toBeUndefined();
  });

  it("reports no picture when what comes back is not one", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(served(new TextEncoder().encode("# not an image at all\n"))));

    expect(await loadReference("docs/report.md", "notes.png", "", null)).toBeUndefined();
  });
});

describe("decodeReference", () => {
  it("reads a PNG's own format and pixel size", async () => {
    expect(await decodeReference(pngBytes(64, 32))).toMatchObject({ kind: "raster", type: "png", width: 64, height: 32 });
  });

  it("keeps a raster's bytes exactly as they arrived", async () => {
    // Embedded as the format it already is, without being redrawn: the bytes the
    // package carries are the bytes that were on disk.
    const bytes = pngBytes(8, 8);
    const picture = await decodeReference(bytes);

    expect(picture?.kind).toBe("raster");
    expect(picture?.kind === "raster" && picture.bytes).toBe(bytes);
  });

  it("has no picture for a format the writer cannot embed", async () => {
    // A WebP is a perfectly good image the viewer draws; the Word writer has no
    // part type for one, so the reference degrades to its alt text rather than
    // producing a part no reader could open.
    const webp = new Uint8Array(16);
    webp.set([...("RIFF" as string)].map((c) => c.charCodeAt(0)), 0);
    webp.set([...("WEBP" as string)].map((c) => c.charCodeAt(0)), 8);

    expect(await decodeReference(webp)).toBeUndefined();
  });
});

describe("rasterHeader", () => {
  it("reads the size of each format the writer can embed", () => {
    expect(rasterHeader(pngBytes(300, 200))).toEqual({ type: "png", width: 300, height: 200 });
    expect(rasterHeader(gifHeaderBytes(300, 200))).toEqual({ type: "gif", width: 300, height: 200 });
    expect(rasterHeader(bmpHeaderBytes(300, 200))).toEqual({ type: "bmp", width: 300, height: 200 });
    expect(rasterHeader(jpegHeaderBytes(300, 200))).toEqual({ type: "jpg", width: 300, height: 200 });
  });

  it("refuses bytes that are not an image, however they are named", () => {
    expect(rasterHeader(new TextEncoder().encode("PNG? no."))).toBeUndefined();
    expect(rasterHeader(new Uint8Array(0))).toBeUndefined();
  });

  it("refuses an image that states no size", () => {
    // A zero-sized picture has no physical size to declare, and Word draws a
    // zero-extent picture as a hole in the page.
    expect(rasterHeader(gifHeaderBytes(0, 200))).toBeUndefined();
  });
});

describe("svgSize", () => {
  it("reads the size from the viewBox, where a figure states it", () => {
    expect(svgSize(svgSource(800, 400))).toEqual({ width: 800, height: 400 });
  });

  it("falls back to the root's own width and height", () => {
    // A hand-written workspace SVG may carry no viewBox at all, and it draws
    // perfectly well in the viewer. Refusing it here would export a picture the
    // reader can see as the words underneath it.
    expect(svgSize('<svg xmlns="http://www.w3.org/2000/svg" width="640px" height="480px"><rect/></svg>')).toEqual({
      width: 640,
      height: 480,
    });
  });

  it("refuses an SVG that states no size at all", () => {
    expect(() => svgSize('<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%"><rect/></svg>')).toThrow(/states no size/);
  });
});
