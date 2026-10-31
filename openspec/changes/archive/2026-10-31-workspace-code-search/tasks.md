# Tasks

## 1. Server search engine

- [x] 1.1 Add `pdfPageTexts(bytes, { timeoutMs })` to `server/src/pdf.ts` (built on `openDocument`, `getTextContent`, `buildLines`/`lineText`); verify in `server/test/pdf.test.ts` that `pdf-text.pdf` yields its text per page and that the image-only page of `pdf-mixed-scan.pdf` yields an empty string without throwing
- [x] 1.2 Create `server/src/contentSearch.ts` with `searchContent(root, query, { signal })`: walk shared with `searchFiles` (symlinks, dot entries and `SEARCH_IGNORED_NAMES` skipped), `lstat` before each read, NUL-byte binary check, 1 MB text cap, PDFs via `pdfPageTexts` (50 MB cap, 5 s each, unreadable PDFs counted in `skipped`), case-insensitive literal match, 200-character excerpts, per-file and total hit caps, 15 s deadline, `truncated` flag, abort on signal; verify with `server/test/contentSearch.test.ts` covering text hits with line, column and excerpt; PDF page hits; ignored directories and binary files; a symlink to a matching file outside the root; the scanned page; an empty or whitespace query; no matches; truncation; and abort. Expected paths are built with `path.join`, and fixtures use CRLF where the line split matters

## 2. Protocol and server wiring

- [x] 2.1 Add `search_content` and `content_search_results` with the `ContentSearchHit` type to `shared/src/protocol.ts`; verify that `npm run typecheck` passes
- [x] 2.2 Handle `search_content` in `server/src/index.ts` with one `AbortController` per socket, aborted by a newer search, a workspace switch or socket close, and no reply once aborted. Add it to `SERVED_WHILE_STARTING`. Verify with a wire test in `server/test/` that a real server answers hits for files in its root, answers nothing outside it, and sends no reply for a search superseded by a newer one

## 3. Client state

- [x] 3.1 In `ui/src/useAgent.ts`, add `contentSearch` state and a `searchContent(query)` action that refuses an empty or whitespace query and sends nothing. Ignore replies with a stale `requestId`, and reset state on `workspace_switched`, `workspace_starting` and `hello`. Verify in `ui/src/useAgent.test.ts` that no message is sent for an empty query, a stale reply is ignored, and a reply arriving after a workspace switch is not shown
- [x] 3.2 Extend `readFile` with an optional `reveal: { query; line?; page? }` stored on `OpenFile` and consumed once; verify in `useAgent.test.ts` that the target is set on open and that a reload drops it

## 4. Files search UI

- [x] 4.1 Add a search panel to `ui/src/components/Sidebar.tsx`, opened by a "Search in files" magnifying-glass button: input with Enter to search, results grouped by file with line or page number and the excerpt with the query highlighted, plus the searching, no-matches, partial and skipped-PDF states. Escape or × goes back to the tree. Verify in `ui/src/components/Sidebar.test.tsx` that an empty query sends nothing, results render, "No matches" shows, and selecting a hit calls `readFile` with the right `reveal`
- [x] 4.2 Wire the panel to `useAgent` in `ui/src/App.tsx`; verify that `npm run typecheck` and the UI suite pass

## 5. Open at match

- [x] 5.1 In `ui/src/components/FileViewer.tsx`, consume `reveal.line`: switch to the source view, open find seeded with the query, and make the current match the first one starting on or after that line. Verify in `ui/src/components/FileViewer.find.test.tsx` that a Markdown file opened at line N selects the match on line N, not the first one in the file
- [x] 5.2 Consume `reveal.page`: open find seeded with the query and pass `startAt` to `PdfViewer`, which starts its current match at the first match on that page. Verify in `ui/src/components/PdfViewer.test.tsx` and `FileViewer.find.test.tsx` that the current match sits on the requested page and that page is the one scrolled to

## 6. Documentation and coverage

- [x] 6.1 Document content search in `README.md` (file browser features) and in `docs/how-to.md`; verify that the documented control name matches the UI label
- [x] 6.2 Write `openspec/changes/workspace-code-search/scenario-coverage.md` mapping all 10 scenarios from `rg '^#### Scenario:' openspec/changes/workspace-code-search` to their tests; verify that `npm run check:scenarios` passes

## 7. Running-app verification

- [x] 7.1 Add `e2e/content-search.spec.ts`: search a seeded workspace, open a text hit and check that the editor's selected line is the hit's line, open a PDF hit and check the current highlight's page, then switch projects mid-search and check that no result shows. Verify with `npx playwright test content-search` after rebuilding `web`, `@pi-outpost/embed` and `build:e2e-host`
- [x] 7.2 Drive the feature on the bench (`npm run bench`, 127.0.0.1:4321) and monkey-test it: double Enter, a query changed mid-search, a matched file deleted before its hit is clicked, rapid open and close of the panel, and a project switch with the panel open. Record what broke and fix it or report it
- [x] 7.3 Run `npm run lint`, `npm run typecheck`, the server and UI suites, and `openspec validate workspace-code-search --strict`, all green

## Workflow follow-up

- Open the PR with a Documentation impact note.
- Archive the change from `main` after merge, never from this branch.
