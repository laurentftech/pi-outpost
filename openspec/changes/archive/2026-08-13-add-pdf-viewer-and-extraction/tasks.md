## 1. Dependency and size cap

- [x] 1.1 Add `pdfjs-dist` to `server/package.json` and `ui/package.json`, pinned to the *same exact* version in both (design D1/D2, and the drift risk).
- [x] 1.2 Add `pdf.maxBytes` to `server/src/config.ts` (optional, default 25 MiB, validated as a positive number) with the existing `fail()` messages for a bad value.
- [x] 1.3 Make `readFileRaw` in `server/src/fileBrowser.ts` take its cap from the requested extension: `pdf.maxBytes` for `.pdf`, `MAX_PREVIEW_BYTES` otherwise. `readFileForPreview` and the write path keep 1 MiB.
- [x] 1.4 Thread the configured PDF cap from `server/src/index.ts` into the `/files/raw` handler; keep `application/octet-stream` + `Content-Disposition: attachment` for PDFs.
- [x] 1.5 Extend `server/test/files-raw.test.mjs`: PDF under its cap → 200, PDF over it → 413, 2 MiB non-PDF → still 413, PDF response still carries the attachment disposition.

## 2. Extraction core (`server/src/pdf.ts`)

- [x] 2.1 Open a PDF from bytes with the legacy `pdfjs-dist` build: no worker, no canvas, `isEvalSupported: false`, PDF scripting off, `useWorkerFetch: false`, bundled standard fonts and cMaps (design D7).
- [x] 2.2 `extractPageText(page)`: items → lines, bucketed by baseline y with a tolerance proportional to item height (design D3, pass 1). Returns lines with their x-spans.
- [x] 2.3 `detectTableBlocks(lines)`: runs of ≥ 3 lines with recurring wide x-gaps (design D3, pass 2). One wide-gap line is not a table.
- [x] 2.4 `linesToMarkdownTable(block)`: cluster x-starts into columns, assign items, emit GFM; header row only above a consistent grid, otherwise headerless (design D3, pass 3).
- [x] 2.5 `extractPdf(bytes, { pages, mode })`: page-attributed markdown (`## Page N`), text and tables in reading order, page cap (20) + character cap (~40 000) + parse deadline, with a trailing note naming the next page to request when a cap truncated it.
- [x] 2.6 Detect a page with no text items and report it as "no text layer" naming those pages; never return an empty result as though the document were blank.
- [x] 2.7 Distinguish and surface the failure kinds the spec names: password-protected, unreadable/corrupt, and budget-exceeded.

## 3. Extraction tests

- [x] 3.1 Add PDF fixtures under `server/test/fixtures/`: a text document, a regular-grid table, a mixed page (paragraph + table), a page with no text layer, an encrypted file, and a truncated/corrupt file. Generate them from a committed script so they can be rebuilt.
- [x] 3.2 `server/test/pdf.test.ts`: text extraction, page-range selection, table reconstruction on the regular grid, mixed-page ordering, `tables` mode on a table-less page.
- [x] 3.3 Tests for the honest-failure paths: no text layer (and the mixed scan/text case), encrypted, corrupt, page cap, character cap and its truncation note, parse deadline.
- [x] 3.4 Confirm mode `text` returns the page verbatim even where the table reconstruction is wrong (the `TableTextRemainsRecoverable` safety valve).

## 4. Tool registration

- [x] 4.1 Build the `pdf_extract` `ToolDefinition` — parameter named `path` so `scopeToRoot` confines it with no new security code (design D4/D6) — with a description telling the model about page ranges and truncation.
- [x] 4.2 Register it among the read tools in `createSandboxedTools` (`server/src/sandbox.ts`), so it follows the read zone and its exceptions and is never gated behind `allowBash`.
- [x] 4.3 Register it on the non-sandboxed path in `server/src/index.ts`, where it resolves against the browser root and refuses escapes itself.
- [x] 4.4 Extend `server/test/sandbox-tools.test.ts`: present in a read-only sandbox, refuses a path resolving outside the root (symlink included), allowed inside a configured read exception, and denied for a prefix look-alike path.

## 5. PDF viewer (`ui/src/components/PdfViewer.tsx`)

- [x] 5.1 Add `isPdfFile` to `ui/src/util/workspacePath.ts` with its tests, mirroring `isImageFile`.
- [x] 5.2 Fetch the bytes from `/files/raw` with a Bearer header (not a token in the URL — this is `fetch`, not `<img>`), and map 413/404/401 onto the viewer's failure states.
- [x] 5.3 Render the current page to canvas with the same hardening as the extractor (`isEvalSupported: false`, scripting off, no network fetch, no annotation-triggered navigation).
- [x] 5.4 Page controls: page number and count, previous/next, zoom, all keyboard-reachable; render pages on demand rather than up front.
- [x] 5.5 Failure states, each with its own message: password-protected, unreadable, too large (naming the limit), and a single failed page that does not blank the document.
- [x] 5.6 Lazy-load the viewer chunk so a session that never opens a PDF does not pay for pdf.js.

## 6. Viewer integration

- [x] 6.1 In `FileViewer.tsx`, branch on `isPdfFile` beside the existing image branch: ignore the `binary` preview error and mount `PdfViewer`.
- [x] 6.2 Offer no Edit action for a PDF whatever the writable zone says.
- [x] 6.3 In `ui/src/attachments.ts`, attach a displayed PDF as a path reference (never bytes); keep the one-automatic-attachment and replacement rules intact.
- [x] 6.4 Tests: PDF opens instead of erroring, page navigation, each failure state, no Edit action, path-reference attachment and no duplicate on rerender.

## 7. Verification

- [x] 7.1 Full server suite + coverage gate (lines 92 / branches 86 / functions 90).
- [x] 7.2 Full UI suite + coverage gate (lines 91 / branches 85 / functions 93).
- [x] 7.3 Measure the built web asset before and after; record the delta and confirm the SEA build still produces a working bundle with the pdf.js worker and font/cMap data inlined (`npm run build:sea --workspace server`). *`web/dist` 5.3 MB → 7.0 MB: pdf.js 417 KB + worker 1.2 MB, both in lazy chunks. `embedded-web.ts` 6.6 MB → 9.2 MB, worker inlined and served (`.mjs` is in the embed MIME map). pdfjs is bundled into `pi-outpost.sea.mjs`. Font/cMap **data files are not bundled** — see the design amendment: they are resolved from the installed package and simply absent in the single-file build.*
- [x] 7.4 Check the embed/Shadow-DOM build: if Vite cannot inline the worker there, fall back to the no-worker path (design, first risk). *`@pi-outpost/embed` builds. The library build cannot emit a sibling asset, so it inlines the worker into the lazy `PdfViewer` chunk (1.7 MB) instead of failing — no fallback needed at build time. Whether that inlined worker starts in a real browser is untested here; it belongs with 7.6.*
- [x] 7.5 `openspec validate add-pdf-viewer-and-extraction --strict`.
- [ ] 7.6 Manually verify against real PDFs from the target application: a long report, one with tables, one scanned, and one over the size cap. Confirm keyboard paging and narrow-width layout.
- [x] 7.7 Document `pdf.maxBytes` and the `pdf_extract` tool in `README.md` and `pi-outpost.config.example.json`.
