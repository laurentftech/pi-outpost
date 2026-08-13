## Context

See `proposal.md` — Why. What shapes the approach, beyond that:

- **The viewer already has an escape hatch for binary files.** `readFileForPreview` refuses a PDF
  with `binary`, and `FileViewer` already ignores that refusal for images (`isImageFile`), loading
  bytes from `/files/raw` instead. PDFs take the same door; nothing in the text-preview protocol
  has to change.
- **`/files/raw` is deliberately paranoid.** Only an image-extension allowlist gets an inline
  content type; everything else is `application/octet-stream` + `Content-Disposition: attachment`,
  behind a token, a `Host` check, and symlink-safe confinement. A client-side renderer keeps all of
  that intact — the bytes arrive as data, never as a document the browser executes.
- **The toolset is assembled, not inherited.** `createSandboxedTools` builds the model's file tools
  from pi's factories and wraps each in `scopeToRoot`, which confines any `path` argument. A tool
  whose parameter is named `path` inherits that confinement for free. Outside sandbox mode the
  server passes `config.tools` through instead — a second wiring point, easy to miss.
- **The server ships as one file.** `build:sea` inlines the UI into `embedded-web.ts` (already
  6.6 MB) and esbuilds `server/src/index.ts` into a single ESM bundle. Anything the extractor needs
  at runtime must be bundled, not resolved from disk at startup.
- **Server tests are `node --test` with coverage gates** (lines 92 / branches 86 / functions 90);
  the UI gate is lines 91 / branches 85 / functions 93. New code lands under both.

## Goals / Non-Goals

**Goals:**
- One PDF pipeline per side, each with a single entry point: `server/src/pdf.ts` for extraction,
  `ui/src/components/PdfViewer.tsx` for rendering.
- Extraction output that an agent can act on without a second guess: page-attributed markdown, a
  stated truncation point, and an explicit "no text layer" instead of an empty string.
- No new attack surface: PDF scripting and `eval` off on both sides, no network fetch during parse,
  bounded pages/time/output.

**Non-Goals:**
- In-document search. Search would want the extractor's output, not the renderer's.
- ~~Text selection and copy in the viewer.~~ *Promoted into scope after the first manual test: a
  canvas-only viewer cannot be read the way a PDF is read. pdf.js's `TextLayer` places the
  document's own text over the canvas, and the ~40 lines of its stylesheet that the layer actually
  needs are copied into the app's CSS rather than importing 160 KB of viewer chrome.*
- Sharing the extraction code between server and browser. The two run in different runtimes with
  different pdf.js builds; a shared "PDF utilities" package is speculative until the viewer needs
  extraction.
- Any equivalence claim with `pdftotext -layout` or a commercial extractor.

## Decisions

### D1 — pdf.js in the client, not the browser's PDF viewer

`/files/raw` keeps serving PDFs as `application/octet-stream; attachment`; the viewer `fetch`es the
bytes (Bearer header, no token in a URL) and renders pages to canvas with `pdfjs-dist`.

*Alternative — serve `application/pdf` inline into an `<iframe>`.* Nearly free, and the browser
gives zoom, print, and search. Rejected: it means dropping the attachment disposition for PDFs, so
a workspace PDF would render in the server's origin through a viewer we do not control and cannot
configure (PDF JavaScript, embedded-file handling, external links). It also renders outside the
app's theme and behaves differently across browsers and inside the embed widget's Shadow DOM.

Cost accepted: ~1–2 MB added to the web bundle and therefore to `embedded-web.ts` and the SEA
binary.

### D2 — pdf.js everywhere, including the extractor

The server extractor uses `pdfjs-dist`'s legacy build, parsing with no worker (pdf.js falls back to
its in-process path when none is configured) and no canvas — `getTextContent()` needs neither.

*Alternative — `pdftotext` (poppler) when present.* Better layout fidelity. Rejected on
availability: it is absent from this machine, absent from most containers, and unavailable when
`allowBash` is false — the tool would fail exactly where it is most needed (a sandboxed, shell-less
deployment), and a per-environment fallback means two output formats to specify and test.

*Alternative — OCR.* Out of scope; the tool reports a missing text layer instead (see
`specs/pdf-documents` — ReportMissingTextLayer).

### D3 — Tables from text-item geometry, in three passes

`getTextContent()` yields items carrying `str` and a transform (x, y), plus `width` and `height`.

1. **Lines.** Bucket items by baseline y within a tolerance proportional to the item height.
2. **Table blocks.** A run of ≥ 3 consecutive lines whose x-gaps exceed a whitespace threshold at
   *recurring* x positions is a candidate block. One line with wide gaps is not a table.
3. **Columns.** Cluster the x-starts across the block into column boundaries, assign each item to a
   column, and emit a GFM table; the first line becomes the header only when it is a single line
   above a consistent grid, otherwise the table is emitted headerless.

Everything outside a block is emitted as text, in reading order. Ruling lines
(`getOperatorList()`) are ignored in this change: they would catch borderless-cell and
merged-cell cases the geometry misses, at the cost of a second parse pass and a much larger
surface. Named as a non-claim in the spec rather than silently approximated.

**Fidelity is bounded and the spec says so.** `TableTextRemainsRecoverable` is the safety valve:
mode `text` always returns the page's raw text, so a misread grid never destroys content.

### D4 — The tool's shape

```
pdf_extract(path: string, pages?: string, mode?: "text" | "tables" | "both")
```

- `path` — named exactly that so `scopeToRoot` confines it with no new security code. This is the
  whole reason the parameter is not called `file` or `document`.
- `pages` — `"3"`, `"2-8"`, `"2-8,12"`; omitted means "from page 1 until a cap stops us".
- `mode` — defaults to `both`.

Output: markdown, `## Page N` per page, tables inline, and a trailing note when a cap truncated the
result naming the next page to ask for. Caps: 20 pages and ~40 000 characters per call, whichever
binds first, plus a parse deadline. A tool result is context the user pays for — this is the
difference between a usable tool and one that burns a session on a 300-page annual report.

*Alternative — return JSON (pages, blocks, cells).* Rejected: every consumer is a language model
reading markdown, and the pi render envelope already exists for anything richer.

### D5 — A per-type size cap, not a bigger global one

`readFileRaw` takes the cap from the requested file's extension: `pdf.maxBytes` (config, default
25 MiB) for `.pdf`, `MAX_PREVIEW_BYTES` for everything else. The text-preview and write paths keep
1 MiB untouched — a PDF is never previewed as text and never written from the browser.

*Alternative — raise `MAX_PREVIEW_BYTES` globally.* Rejected: it would widen what any preview,
image, or save can pull into memory, to fix one format.

### D6 — Registration in both toolset paths

`pdf_extract` is appended to the read tools in `createSandboxedTools`, and passed as a custom tool
when no sandbox is configured. Outside a sandbox there is no `scopeToRoot`, so the tool resolves
its path against the workspace and refuses escapes on its own.

*Corrected during implementation:* that last part makes `pdf_extract` **stricter** than the
built-in read tools, which are not confined at all without a sandbox. Keeping the confinement is
the safer direction and costs nothing — but the original wording ("matching what the built-in read
tools already do there") was simply wrong about them.

### D7 — Untrusted input, on both sides

Every parse runs with `useWorkerFetch: false` and no system-font probing. The extractor
additionally caps pages, wall-clock time, and output size (D4). The renderer disables
annotation-triggered navigation (`annotationMode: 0`): no link, widget or action inside a PDF is
rendered, so none can be followed.

**Amended during implementation, twice:**

- *There is no `isEvalSupported` to set.* pdf.js 6 removed it along with eval itself — the shipped
  build contains no `eval` or `new Function`, and the core API exposes no PDF-scripting switch
  because it never runs a document's JavaScript. The guarantee this decision wanted is upstream
  now; passing the flag would only have been a type error.
- *Font and cMap data are resolved, not bundled.* Together they are 2.4 MB of loose files, which
  esbuild cannot fold into the single-file build without a loader per file. They are resolved from
  the installed `pdfjs-dist` when it is on disk (npm, npx) and absent in the SEA build, where a
  document needing them reports unextractable text instead of emitting mojibake. This weakens the
  CJK mitigation for SEA deployments specifically; it is worth revisiting if that becomes real.

### D8 — The viewer owns nothing it cannot release, and fails locally

Added after the first manual test, which produced a **blank application**, twice: on opening the
PDF and again while the agent was reading it.

The cause was a single wrong assumption about pdf.js's object graph: `destroy()` lives on the
**loading task**, not on `PDFDocumentProxy`. Calling it on the proxy throws — and the call sat in
an effect cleanup, where an exception unmounts the entire React tree. The test fake had grown a
`destroy()` the real API never had, so the suite was green throughout.

Three consequences, all implemented:

1. The component keeps the loading task and releases the document through it.
2. Every render task is cancelled before the next starts (pdf.js refuses two renders on one canvas)
   and on unmount; a `RenderingCancelledException` is not reported as a page that failed.
3. Cleanup paths never throw, and a `ViewerErrorBoundary` wraps the viewer so any future crash
   costs the pane rather than the session.

The rule this leaves behind: **a fake that is kinder than the API it stands for is not a test.**
The viewer fakes now mirror pdf.js exactly — no `destroy()` on the document, `cancel()` on every
render task.

### D9 — Continuous scroll, windowed rendering

Also added after manual use: a one-page-at-a-time viewer is not how anyone reads a PDF.

Every page gets a slot at its full height as soon as the document opens — sized from page 1's
viewport, corrected from each page's own once it draws — so the scrollbar measures the document
from the first frame. Only pages within one of the page being read hold a canvas and a text layer;
scrolling away unmounts them, which is what releases the bitmap. Forty pages of rendered canvas at
125% is hundreds of megabytes, and that is the whole reason for the window.

The page indicator follows an `IntersectionObserver` whose root margins collapse the observation
band to the viewport's middle line, so exactly one page qualifies as "the page being read". Where
`IntersectionObserver` is missing (jsdom, and any host without it), the indicator simply stops
following the scroll — the controls and the keyboard still work.

*Trade-off accepted:* a page's slot is sized from page 1 until it draws, so a document mixing
portrait and landscape pages shifts slightly as those pages render. Measuring every page up front
would cost a `getPage` per page at open time — the wrong trade for a 400-page report.

### D10 — Extraction never consumes its input

pdf.js transfers the `data` buffer to its worker and detaches it, so a second `extractPdf` on the
same bytes failed with `Cannot transfer object of unsupported type` — and the caller's array was
silently emptied. `extractPdf` now copies its input. One copy per call is nothing against parsing,
and the alternative is an API that destroys what it is given.

## Risks / Trade-offs

- **Bundle growth (~1–2 MB) reaches the SEA binary and `embedded-web.ts`** → Load the viewer
  chunk lazily so only sessions that open a PDF pay the parse cost; measure the built asset before
  and after and record it in the task's verification step. If the pdf.js worker cannot be inlined
  by Vite for the embed/Shadow-DOM build, fall back to the same-file (no worker) path there.
- **CJK and other non-Latin PDFs need cMap data** that pdf.js fetches by default → bundle the cMaps
  with the extractor and point `cMapUrl` at the bundled copy; a PDF whose glyphs cannot be mapped
  must report unextractable text rather than emit mojibake.
- **Table reconstruction will be wrong on some real documents** → mode `text` always returns the
  page verbatim, the tool states which pages it turned into tables, and merged/ruled-only tables
  are declared out of claim in the spec.
- **A malicious PDF as a parser bomb** (deep nesting, huge object graphs, decompression blowups)
  → page cap, output cap, and a parse deadline; failure is a tool error, not a hung session.
- **25 MiB of PDF through a WebSocket-adjacent HTTP route** → the bytes stream from disk as they do
  today; the risk is the client holding the whole document in memory, which the page-cap and lazy
  rendering bound on the render side but not on the fetch side. Accepted for a localhost-first tool.
- **`pdfjs-dist` in two workspaces can drift to two versions** → pin the same exact version in both
  `ui` and `server`; a mismatch means the viewer and the agent disagree about what a document says.

## Migration Plan

No data migration and no protocol change. `pdf.maxBytes` is a new optional config key with a
default, so existing configs keep working. Rolling back is removing the dependency and the two new
modules; nothing else takes a dependency on them.

## Open Questions

- Whether the viewer should eventually render a selectable text layer or reuse `pdf_extract`'s
  output for in-document search. Deferrable: neither changes the specs or the tool contract here.
