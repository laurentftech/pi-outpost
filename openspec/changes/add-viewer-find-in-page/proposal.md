## Why

The file viewer has no way to search within an open document. A PDF or a text/code/Markdown file
of any real length can only be searched by scrolling and reading, because the browser's native
Ctrl+F either does not reach the content (a PDF's canvas pages, an edit-mode textarea's value) or
searches the whole page including chat history and other UI. Every other reading surface in the
app that shows a document of length benefits from find-in-page; this is missing everywhere.

## What Changes

- Add a find-in-page bar to the full-size file viewer, opened with Ctrl+F / Cmd+F while the viewer
  is focused, closed with Escape. It shows a query field, a match count ("3/17"), next/previous
  controls, and Enter/Shift+Enter to step through matches.
- Text, Markdown (both source and rendered view), and code files: matches are found in the
  document's current text — the edit buffer when one is open, the file content otherwise — and the
  current match is highlighted and scrolled into view. Search is case-insensitive by default.
- PDF files: matches are found across the *whole* document, not only the pages currently rendered.
  Opening find triggers a one-time, incremental text index of the document (reusing pdf.js's own
  per-page text extraction); navigating to a match jumps to its page and highlights it at its exact
  position on the page, the way a native PDF reader's find does.
- In edit mode (textarea), the current match is selected via the textarea's native selection and
  scrolled into view; other matches are not overlay-highlighted, since a textarea's value cannot
  carry markup.
- Ctrl+F is captured only while the file viewer has focus, so it does not shadow the browser's own
  find elsewhere in the app.

## Capabilities

### New Capabilities
- `viewer-find-in-page`: find-in-page search inside the full-size file viewer, covering plain
  text/code, Markdown (source and rendered), the edit-mode textarea, and PDF documents.

### Modified Capabilities
(none — this adds a capability layered on top of the existing viewers without changing their
existing requirements)

## Impact

- `ui/src/components/FileViewer.tsx`: owns the find bar's open/closed state and Ctrl+F/Escape
  capture; wires the query to whichever text is currently displayed (source, rendered Markdown, or
  edit buffer) and to `PdfViewer` when the open file is a PDF.
- `ui/src/components/PdfViewer.tsx`: exposes a way to index a document's text per page, search it,
  and highlight a match's bounding box on its (possibly not-yet-rendered) page; extends `goTo` so
  navigating to a match's page happens before highlighting it.
- New shared UI: a find-bar component and a text-highlighting utility (DOM-based for rendered text,
  bounding-box based for PDF canvases), placed under `ui/src/components/` and `ui/src/util/`.
- No server or protocol changes — this is client-only, since both the file's text and the PDF bytes
  are already available in the browser.
