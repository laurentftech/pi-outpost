## Why

The target workspace is full of PDFs, and pi-outpost is blind to them at both ends. Selecting one
in the tree fails: `readFileForPreview` finds a NUL byte, answers `binary`, and the viewer shows an
error — the file is in the tree but cannot be looked at. The agent is no better off: its toolset is
`read`/`ls`/`grep`/`find` (+ `edit`/`write`/`bash` when allowed), all of which treat a PDF as
mojibake, so answering "what does this table say" requires a shell, an external binary, and
`sandbox.allowBash`.

Both halves are the same gap — a file format the workspace is made of, that neither the human nor
the agent can open.

## What Changes

- **PDF viewer in the file viewer.** Selecting a `.pdf` in the tree renders it (pdf.js, embedded)
  instead of the `binary` error, the way images already bypass the text-preview protocol: page
  navigation, zoom, lazy page rendering, keyboard paging, theme-aware chrome.
- **`pdf_extract` agent tool.** A new tool definition, added to the sandboxed toolset alongside
  `read`, confined to the sandbox root by the same `path`-argument scoping. Returns markdown: text
  per page, and tables reconstructed as GFM tables from the text layer's coordinates. Takes a page
  range and a mode (`text` / `tables` / `both`), and caps its own output so one call cannot flood
  the context window.
- **A size cap for PDFs.** `/files/raw` rejects anything over 1 MiB, which excludes most real PDFs.
  PDFs get their own configurable cap (default 25 MiB); every other file keeps the 1 MiB limit.
- **PDF previews become prompt attachments** by path reference, like text files — now meaningful,
  because the agent has a tool that can read the referenced path.

Explicitly **not** in this change: OCR for scanned PDFs (the tool reports "no text layer" instead
of guessing), in-document search, annotation/form rendering, PDF editing, and any external binary
(`pdftotext` and friends stay out — the SEA build must stay self-contained).

## Capabilities

### New Capabilities
- `pdf-documents`: viewing a workspace PDF in the file viewer, and extracting its text and tables
  for the agent — including what happens when a PDF is encrypted, corrupt, oversized, or has no
  text layer at all.

### Modified Capabilities
- `api`: `GETFilesRaw` — the 1 MiB rejection becomes per-type, so a PDF may be served up to its own
  configured cap. Content type and `Content-Disposition: attachment` are unchanged: the viewer
  fetches bytes and renders them itself, so no workspace PDF ever renders in the server's origin.
- `file`: `CreateSandboxedTools` — the sandboxed toolset gains `pdf_extract` among the read tools.
  `FullSizeFileViewer` — a selected PDF is displayed rather than reported as binary.
- `preview-file-attachments`: `Automatically attach the active preview` — a displayed PDF attaches
  as a path reference (it is neither a text file nor an image, so today's rule does not name it).

## Impact

**New dependency, two workspaces**: `pdfjs-dist` in `ui` (rendering, worker asset) and in `server`
(extraction, no canvas needed). It must survive both the embedded web bundle
(`server/src/embedded-web.ts`, already 6.6 MB) and the SEA build — the worker and any standard-font
data have to be bundled, not fetched.

**Server**: `server/src/fileBrowser.ts` (per-type size cap), `server/src/index.ts`
(`/files/raw` cap lookup, non-sandboxed toolset wiring), `server/src/sandbox.ts` (register
`pdf_extract`), `server/src/config.ts` (`pdf.maxBytes`), plus a new `server/src/pdf.ts`.

**UI**: `ui/src/util/workspacePath.ts` (`isPdfFile`), `ui/src/components/FileViewer.tsx` (the PDF
branch), a new `ui/src/components/PdfViewer.tsx`, `ui/src/attachments.ts` (PDF → path reference).

**Untrusted input**: a PDF is attacker-controlled data parsed in-process, on the server by the
extractor and in the browser by the renderer. Both must run with PDF scripting and eval disabled,
no network fetching, and bounded page/time/output budgets.
