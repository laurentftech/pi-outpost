## Context

See proposal.md - Why. Two viewers need find-in-page and they store text very differently:

- `FileViewer.tsx` shows plain/highlighted text as real DOM text nodes (`CodeHighlight`'s
  `dangerouslySetInnerHTML`, or `ReactMarkdown`'s output), or as a `<textarea>` value while editing.
  DOM text is walkable and markable; a textarea's value is not.
- `PdfViewer.tsx` shows each page as a `<canvas>` bitmap with a transparent, selectable text layer
  (`pdfjs.TextLayer`) laid over it — but only for pages within `RENDER_WINDOW` of the current one
  (`ui/src/components/PdfViewer.tsx:156`). A page outside that window has no DOM text at all.
  pdf.js 6.2 exposes `page.getTextContent()` (a promise) independently of the streamed variant
  used for the visible text layer, so a page's text can be read for indexing without rendering it.

## Goals / Non-Goals

**Goals:**
- One find-bar UX (query, count, next/prev, Enter/Shift+Enter, Escape) shared across text, code,
  Markdown (both view modes), and PDF.
- PDF search covers the whole document, with results usable before indexing finishes.
- PDF match highlighting lands at the match's exact position on the page.
- No new runtime dependency: build on `pdfjs-dist` (already a dependency) and plain DOM APIs.

**Non-Goals:**
- The side-by-side split mode and the git-diff view are not searchable in this change — both
  already show two content areas at once, and defining "the current match" across two panes is a
  separate design question left for later if requested.
- Regular-expression or whole-word search. Plain case-insensitive substring only.
- Cross-file search (searching files other than the one open). This is Ctrl+F, not a project
  search.
- Persisting the query across files or sessions.

## Decisions

### Shared highlight utility, DOM-based, not `window.find()` or the CSS Custom Highlight API

Matches in rendered text (source view, rendered Markdown, a PDF page's text layer) are marked by
walking the container's text nodes with a `TreeWalker`, locating substring matches against the
concatenation of their text, and splitting/wrapping the matched ranges in `<mark>` elements —
current match gets a distinguishing class.

Alternatives considered:
- `window.find()`: deprecated, inconsistent across browsers, and cannot be scoped to a container
  (it searches the whole page) or report a match count.
- CSS Custom Highlight API (`CSS.highlights`, `Range`-based, no DOM mutation): elegant and avoids
  reflow from node splitting, but not supported on the full browser range this app targets; using
  it would mean two separate highlighting code paths anyway (a fallback still needed). A single
  `<mark>`-based path everywhere is simpler to reason about and to test, and file sizes here are
  bounded (1 MiB preview limit), so the reflow cost is not a concern.

This utility takes a container element, is re-run whenever the query or the container's content
changes, and returns the ordered list of match elements so the caller can scroll to and style the
current one. It is oblivious to whether the container holds highlighted code, rendered Markdown, or
a PDF's text layer — it only needs a container and a query.

### PDF: index built from `getTextContent()`, matches drawn through the existing text layer

Rather than computing highlight rectangles from raw `TextItem.transform` matrices, a match is
highlighted by re-using the *rendered* text layer: once the target page is within the render
window, its `pdfjs.TextLayer` spans hold exactly the text `drawTextLayer` already places at the
right screen position (`ui/src/components/PdfViewer.tsx:115`). The shared highlight utility runs
against that container the same way it runs against source code. This means:
- No second, independent coordinate system to keep in sync with rendering, zoom, and scroll.
- Highlighting a PDF match and highlighting code share one implementation.
- The cost is a wait for the target page to render before the highlight can appear, already true
  today for `goTo()` scrolling to a page.

The search index itself (separate from the text layer) is a plain array, built once per open
document and invalidated when the path or revision changes: for each page, its concatenated
`getTextContent()` string and the char-offset of each query match. It is built lazily, one page at
a time, starting from the currently open page and expanding outward, yielding control between
pages (e.g., `requestIdleCallback`/`setTimeout(0)`) so a long document does not block the main
thread. This is the same "read ahead" shape as extraction elsewhere in this codebase (bounded,
incremental, never all-at-once against an unbounded document), scaled down since this indexes text
already fetched into the browser rather than calling a server tool.

Alternative considered: adopt pdf.js's own `PDFFindController` from its `web/` viewer layer. It
solves exactly this problem, but it is designed to run inside pdf.js's full `PDFViewer` component
(`EventBus`, `PDFLinkService`, its own page-rendering pipeline), which this codebase deliberately
does not use — `PdfViewer.tsx` renders pages itself for tight control over the render window and
memory. Pulling in `PDFFindController` alone, without the rest of that viewer layer, is not a
supported usage and would fight the existing rendering approach more than it would save.

### Ctrl+F capture scope

The keydown listener is added at the document level for the lifetime of the mounted file viewer,
mirroring the existing Escape-to-close listener (`FileViewer.tsx:457-463`) — the viewer is a
full-screen overlay while open (`className="absolute inset-0 z-20"`), so there is nothing else on
screen for Ctrl+F to mean. `preventDefault()` is only called when the current view is searchable
(see the `FindNotOfferedOutsideSupportedViews` scenario); otherwise the key passes through
untouched.

## Risks / Trade-offs

- [Risk] Splitting text nodes to insert `<mark>` elements inside `CodeHighlight`'s
  `dangerouslySetInnerHTML` output is undone whenever that `html` state updates (e.g., the file's
  content changes) → Mitigation: the highlight effect re-runs after every render of the content
  container, keyed on the same content the container was built from, so marks are always
  reapplied against the latest DOM rather than assumed to persist.
- [Risk] A pathological query (a very common single character) in a large source file produces
  thousands of matches and thousands of `<mark>` elements → Mitigation: file previews are already
  capped at 1 MiB; cap the marked-match count (e.g., a few thousand) and say so in the count
  ("500+ matches") rather than degrade the page.
- [Risk] Building the PDF text index competes with page rendering for main-thread time on a large
  document → Mitigation: indexing yields between pages and starts from the page currently open, so
  the pages the reader is most likely to search near are indexed first.
- [Trade-off] PDF highlighting requires the target page to render before it can be shown, so
  jumping to a far-away match has a brief delay while that page's canvas and text layer draw. This
  matches the delay `goTo()` already has today for the same reason, so it is not a new class of
  behavior.

## Migration Plan

Additive, client-only, one PR. No data migration, no server or protocol change, no flag needed —
the find bar simply does not appear until Ctrl+F is pressed. Rollback is reverting the PR.
