/**
 * Reading a PDF's text for search, page by page, independently of which pages are
 * currently rendered — a page outside the viewer's render window has no DOM text
 * to search (see PdfViewer.tsx), so find-in-page needs its own copy of the text.
 */
import { findMatchesInText } from "./findInPage";

export interface PdfTextSource {
  numPages: number;
  /** The page's text, concatenated. A page with no extractable text (a scan)
   * resolves to an empty string — that is not an error here. */
  getPageText(pageNumber: number): Promise<string>;
}

/**
 * Page numbers (1-based), starting at `startPage` and alternating outward
 * (start, start-1, start+1, start-2, start+2, …) — the pages nearest to what the
 * reader is already looking at are read first.
 */
export function pageReadOrder(numPages: number, startPage: number): number[] {
  if (numPages <= 0) return [];
  const start = Math.min(Math.max(Math.round(startPage), 1), numPages);
  const order = [start];
  let lo = start - 1;
  let hi = start + 1;
  while (lo >= 1 || hi <= numPages) {
    if (lo >= 1) order.push(lo--);
    if (hi <= numPages) order.push(hi++);
  }
  return order;
}

/**
 * Reads every page's text in `pageReadOrder`, yielding control between pages so a
 * long document does not block the main thread. A page that fails to read
 * contributes an empty string rather than aborting the whole index.
 *
 * Returns a handle to cancel: once cancelled, no further `onPage`/`onDone` calls
 * are made, even for a read already in flight when `cancel` is called.
 */
export function indexPdfText(
  source: PdfTextSource,
  startPage: number,
  onPage: (pageNumber: number, text: string) => void,
  onDone: () => void,
  yieldToMainThread: () => Promise<void> = () => new Promise((resolve) => setTimeout(resolve, 0)),
): { cancel: () => void } {
  let cancelled = false;
  const order = pageReadOrder(source.numPages, startPage);

  void (async () => {
    for (const page of order) {
      if (cancelled) return;
      let text: string;
      try {
        text = await source.getPageText(page);
      } catch {
        text = "";
      }
      if (cancelled) return;
      onPage(page, text);
      await yieldToMainThread();
    }
    if (!cancelled) onDone();
  })();

  return {
    cancel: () => {
      cancelled = true;
    },
  };
}

export interface PdfMatch {
  page: number;
  /** 0-based position of this match among the matches on its own page. */
  ordinalOnPage: number;
}

/** Every match across every page indexed so far (`pageTexts`), in page order.
 * A page not yet in `pageTexts` is treated as not-yet-searched, not as empty —
 * its matches, if any, appear once it is indexed. */
export function searchPdfIndex(pageTexts: ReadonlyMap<number, string>, numPages: number, query: string): PdfMatch[] {
  if (query === "") return [];
  const matches: PdfMatch[] = [];
  for (let page = 1; page <= numPages; page++) {
    const text = pageTexts.get(page);
    if (text === undefined) continue;
    const found = findMatchesInText(text, query);
    for (let ordinalOnPage = 0; ordinalOnPage < found.length; ordinalOnPage++) {
      matches.push({ page, ordinalOnPage });
    }
  }
  return matches;
}
