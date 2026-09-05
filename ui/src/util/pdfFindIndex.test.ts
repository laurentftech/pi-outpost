import { describe, expect, it, vi } from "vitest";
import { indexPdfText, pageReadOrder, searchPdfIndex, type PdfTextSource } from "./pdfFindIndex";

describe("pageReadOrder", () => {
  it("starts at the given page and alternates outward", () => {
    expect(pageReadOrder(7, 4)).toEqual([4, 3, 5, 2, 6, 1, 7]);
  });

  it("clamps a start page outside the document to the nearest real page", () => {
    expect(pageReadOrder(3, 99)).toEqual([3, 2, 1]);
    expect(pageReadOrder(3, 0)).toEqual([1, 2, 3]);
  });

  it("handles a one-page document", () => {
    expect(pageReadOrder(1, 1)).toEqual([1]);
  });

  it("handles an empty document", () => {
    expect(pageReadOrder(0, 1)).toEqual([]);
  });
});

describe("indexPdfText", () => {
  function source(pages: Record<number, string | (() => Promise<string>)>, numPages: number): PdfTextSource {
    return {
      numPages,
      getPageText: async (page) => {
        const entry = pages[page];
        if (typeof entry === "function") return entry();
        if (entry === undefined) throw new Error(`no page ${page}`);
        return entry;
      },
    };
  }

  it("reads pages incrementally, starting from the given page", async () => {
    const seen: number[] = [];
    const onDone = vi.fn();
    indexPdfText(source({ 1: "alpha", 2: "beta", 3: "gamma" }, 3), 2, (page) => seen.push(page), onDone, () => Promise.resolve());

    await vi.waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(seen).toEqual([2, 1, 3]);
  });

  it("yields between pages instead of reading the whole document synchronously", async () => {
    const yields: number[] = [];
    const onDone = vi.fn();
    const seenBeforeYield: number[] = [];
    indexPdfText(
      source({ 1: "a", 2: "b" }, 2),
      1,
      (page) => seenBeforeYield.push(page),
      onDone,
      () => {
        yields.push(seenBeforeYield.length);
        return Promise.resolve();
      },
    );

    await vi.waitFor(() => expect(onDone).toHaveBeenCalled());
    // A yield happened after each page was reported, not all at once at the end.
    expect(yields).toEqual([1, 2]);
  });

  it("treats a page that fails to read as contributing empty text, not an error", async () => {
    const seen: Array<{ page: number; text: string }> = [];
    const onDone = vi.fn();
    indexPdfText(
      source({ 1: "alpha", 2: () => Promise.reject(new Error("scan, no text layer")), 3: "gamma" }, 3),
      1,
      (page, text) => seen.push({ page, text }),
      onDone,
      () => Promise.resolve(),
    );

    await vi.waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(seen.find((entry) => entry.page === 2)).toEqual({ page: 2, text: "" });
  });

  it("cancel() stops further pages, including one already in flight", async () => {
    const seen: number[] = [];
    const onDone = vi.fn();
    let resolvePage2: (() => void) | undefined;
    const handle = indexPdfText(
      source({ 1: "a", 2: () => new Promise((resolve) => (resolvePage2 = () => resolve("b"))), 3: "c" }, 3),
      1,
      (page) => seen.push(page),
      onDone,
      () => Promise.resolve(),
    );

    await vi.waitFor(() => expect(resolvePage2).toBeDefined());
    handle.cancel();
    resolvePage2?.();

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(seen).toEqual([1]);
    expect(onDone).not.toHaveBeenCalled();
  });
});

describe("searchPdfIndex", () => {
  it("finds matches across every indexed page, in page order", () => {
    const pageTexts = new Map([
      [1, "the quick fox"],
      [2, "a fox in the box"],
    ]);
    expect(searchPdfIndex(pageTexts, 2, "fox")).toEqual([
      { page: 1, ordinalOnPage: 0 },
      { page: 2, ordinalOnPage: 0 },
    ]);
  });

  it("orders multiple matches on one page by their position", () => {
    const pageTexts = new Map([[1, "fox fox fox"]]);
    expect(searchPdfIndex(pageTexts, 1, "fox")).toEqual([
      { page: 1, ordinalOnPage: 0 },
      { page: 1, ordinalOnPage: 1 },
      { page: 1, ordinalOnPage: 2 },
    ]);
  });

  it("skips a page that has not been indexed yet, without treating it as searched", () => {
    const pageTexts = new Map([[1, "fox"]]); // page 2 not indexed yet
    expect(searchPdfIndex(pageTexts, 2, "fox")).toEqual([{ page: 1, ordinalOnPage: 0 }]);
  });

  it("reports no matches, not an error, for a page with no extractable text", () => {
    const pageTexts = new Map([
      [1, ""], // scanned page: indexed, empty
      [2, "fox"],
    ]);
    expect(searchPdfIndex(pageTexts, 2, "fox")).toEqual([{ page: 2, ordinalOnPage: 0 }]);
  });

  it("returns nothing for an empty query", () => {
    const pageTexts = new Map([[1, "fox"]]);
    expect(searchPdfIndex(pageTexts, 1, "")).toEqual([]);
  });
});
