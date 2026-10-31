# Design

## Context

- Filename search already exists: `search_files` → `searchFiles(browserRoot, query)` in
  `server/src/fileBrowser.ts`, used by the composer's `@` mention. It walks the tree with
  `readdir({ withFileTypes })`, skips symbolic links, dot entries and
  `SEARCH_IGNORED_NAMES`, and caps the walk at `SEARCH_MAX_VISITED`. Its results carry a
  `requestId` and the reducer drops replies whose id is no longer current.
- `ui/src/presentations/CodeSearchView.tsx` renders the agent's grep tool output in the
  transcript. It has nothing to do with this change and stays as it is.
- PDF text already goes through `server/src/pdf.ts`. Its `openDocument` loads pdf.js with
  network fetching and system-font probing turned off, and with a deadline.
  `buildLines` / `lineText` turn the text items into lines.
- The file viewer already has find-in-page (`viewer-find-in-page`): `"text"` mode for source
  and the editor, `"dom"` mode for rendered views, and `"pdf"` mode, which indexes the whole
  document and highlights the match on its page. The OpenFile state has no "open at" target
  yet.
- Several workspaces share one socket. `workspace_switched`, `workspace_starting` and `hello`
  reset per-workspace client state in `useAgent`.

## Goals / Non-Goals

**Goals:**
- A literal, case-insensitive content search on the server, with bounded cost, confined to
  `browserRoot`, that works in the SEA executable and on Windows with nothing to spawn.
- Opening a result reuses the existing find machinery, so a match is highlighted the same way
  whether the reader found it from Files or with Ctrl+F.

**Non-Goals:**
- OpenLore or any other semantic or indexed source. The proposal left this open; this change
  rules it out. Plain search must stand on its own, and an optional backend can arrive later
  behind the same message without changing the UI.
- Regular expressions, whole-word or case-sensitive options, and replace.
- Office documents (`.docx`, `.pptx`, `.xlsx`). They are zip files, so they fall under the
  binary rule.
- `.gitignore`-aware filtering. It uses the same ignore list as filename search.

## Decisions

### A pure Node walker, not `rg`
`searchContent(root, query, { signal })` in a new `server/src/contentSearch.ts` walks the tree
the same way `searchFiles` does, with the same filter, so the two searches agree on what the
workspace contains.
- *Alternative:* spawn `rg` when it is on the PATH. It's faster on large trees, but the office
  Windows box cannot spawn binaries from its PATH, the SEA executable would need a vendored
  binary, and running two engines means two sets of results to keep consistent.

### Confinement
- Directory entries come from `readdir({ withFileTypes })`. Symbolic links are skipped and
  never followed, so a link out of the root is never opened.
- Before each file is read, `lstat` must confirm it is still a regular file. This covers a
  swap between listing and reading.
- Result paths are root-relative, joined with `/`, the same way the file tree joins them.

### What counts as searchable
- Text files: up to 1 MB. The first 8 KB are read and dropped if they contain a NUL byte (the
  same `looksBinary` heuristic previews use). The content is decoded as UTF-8 and split on
  `/\r?\n/`. Matching lowercases both sides.
- PDFs, by extension: up to 50 MB. They are read with a new `pdfPageTexts(bytes, { timeoutMs })`
  in `pdf.ts`, built on `openDocument` plus `getTextContent` and `buildLines`, which yields each
  page's text. A page with no text layer yields an empty string, so it contributes nothing and
  raises no error. An encrypted, corrupt or timed-out PDF is skipped and counted as skipped; the
  search does not fail.
- Every other file, and every file over its size limit, is skipped.

### Bounds and cancellation
- At most 500 hits overall and 20 per file. The walk stops at `SEARCH_MAX_VISITED` entries and
  after 15 s. When any limit is hit, the reply sets `truncated: true` and the UI says the results
  are partial.
- Each PDF gets a 5 s deadline.
- The server keeps one `AbortController` per socket. A new `search_content` from the same socket
  aborts the previous search, and so do switching the socket's workspace and closing it. An
  aborted search sends no reply.

### Protocol
- Client: `{ type: "search_content"; query: string; requestId: string }`.
- Server: `{ type: "content_search_results"; requestId; query; hits: ContentSearchHit[]; truncated: boolean; skipped: number }`.
- `ContentSearchHit` is either `{ path; kind: "line"; line; excerpt; column }` or
  `{ path; kind: "pdf-page"; page; excerpt }`. The excerpt is cut to at most 200 characters
  around the first match, with whitespace collapsed for PDFs.
- An empty or whitespace-only query is refused on both sides. The client sends nothing, and the
  server answers with no hits.
- `search_content` joins `SERVED_WHILE_STARTING`, because like the tree it doesn't need the
  agent.

### Workspace association
- The reducer holds `contentSearch: { requestId, query, status, hits, truncated, skipped } | null`.
- `workspace_switched`, `workspace_starting` and `hello` reset it to `null`. A reply whose
  `requestId` is not the current one is ignored. This combines the guard filename search
  already uses with the reset other per-workspace state already gets.
- The server-side abort on switch is defence in depth. The client guard is what the spec relies
  on.

### UI
- The Files header gets a magnifying-glass button, labelled "Search in files", that turns the
  panel into search mode: an input, then results grouped by file with a match count. Each hit is
  a row showing the line or page number and the excerpt, with the query highlighted.
- Enter runs the search; there is no search-as-you-type. A content search is costly, and running
  one on every keystroke would keep cancelling walks that are half done.
- Escape or the × button returns to the tree and keeps the last query and its results until the
  workspace changes.
- States shown: searching…, "No matches", partial results, and the number of PDFs skipped when
  there are any.

### Open at match through the find machinery
- `readFile` gains an optional `reveal: { query; line?: number; page?: number }`, which is stored
  on `OpenFile`.
- For a line hit, FileViewer switches the file to its source view, so a rendered Markdown or HTML
  file still shows the line. It then opens the find bar seeded with the query, and the current
  match becomes the first one starting on or after that line.
- For a PDF hit, FileViewer opens the find bar seeded with the query, and `PdfViewer` gets a
  `startAt`, so its current match is pinned to the first match on that page until the whole document is indexed. Its existing jump and
  on-page highlight then bring the match into view.
- `reveal` is consumed once, when the read lands. A reload or a later edit doesn't re-apply it.
- *Alternative:* a dedicated "scroll to line" path. It would duplicate highlighting that
  find-in-page already does correctly and has already been tested in the running app.

## Risks / Trade-offs

- [Huge workspaces make the walk slow] → visit cap, 15 s deadline, abort on the next query,
  results marked partial.
- [pdf.js work on large PDFs blocks the event loop between awaits] → 5 s per document, 50 MB cap,
  and the walk yields between files. If the bench shows stalls, the next step is a worker thread;
  that is not built now.
- [Dot directories (`.github`, `.vscode`) aren't searched] → consistent with filename search;
  this can be revisited for both searches together.
- [Excerpts reveal file content] → only what the user could already open from the tree under the
  same root.

## Migration Plan

Additive protocol messages and UI. There is nothing to migrate. Rolling back removes the button
and the message handler.
