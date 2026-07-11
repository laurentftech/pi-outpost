# Tasks: file-viewer-editor

## 1. Wire protocol

- [x] 1.1 Add `mtimeMs` to the `file_content` ServerMessage in `shared/src/protocol.ts`
- [x] 1.2 Add ClientMessage variant `{ type: "write_file"; path; content; expectedMtimeMs; requestId }`
- [x] 1.3 Add ServerMessage variant `{ type: "file_written"; requestId; path; size; mtimeMs }`

## 2. Server

- [x] 2.1 Return `mtimeMs` from `readFileForPreview` in `server/src/fileBrowser.ts` and pass it through the `read_file` handler in `server/src/index.ts`
- [x] 2.2 Implement `writeFileFromBrowser` in `fileBrowser.ts`: resolveConfined against the writable zone (no sandbox → browser root; read-only sandbox → refuse), reject content > `MAX_PREVIEW_BYTES`, stat-compare `expectedMtimeMs` (mismatch or missing file → new `"conflict"` FileBrowserError reason), write, return `{ size, mtimeMs }`
- [x] 2.3 Add `write_file` case in the WS handler: field type checks, call `writeFileFromBrowser`, answer `file_written` or `file_browser_error`, broadcast `file_changed` on success
- [x] 2.4 Test with a WS script: save inside zone, outside zone, read-only sandbox, stale mtime, oversized content

## 3. Frontend state

- [x] 3.1 Extend `OpenFile` in `web/src/useAgent.ts` with `mtimeMs`; handle `file_written` (update mtime, clear saving flag) and surface `file_browser_error` conflicts distinctly
- [x] 3.2 Add `writeFile(path, content, expectedMtimeMs)` action sending `write_file` with a requestId
- [x] 3.3 On `file_changed` for the currently open file, mark it stale in state (viewer shows "changed on disk" banner)

## 4. Viewer/editor UI

- [x] 4.1 Create `FileViewer.tsx`: full-size overlay over the chat main pane, header (path, copy, markdown rendered/source toggle, close), body reusing `CodeHighlight`/`ReactMarkdown`; Escape and ✕ close it
- [x] 4.2 Wire selection: clicking a file in the tree opens the overlay viewer (sidebar `FilePreview` pane replaced by the overlay)
- [x] 4.3 Edit mode: Edit button visible only when the file is writable (`writableRoot === undefined`, or inside the writable subtree); monospace textarea, dirty tracking, Save (and Cmd/Ctrl+S) calling `writeFile`
- [x] 4.4 Conflict & staleness UX: on conflict error or `file_changed` while open, show banner with "reload" (refetch, discard edits) and "keep editing"; confirm before closing with unsaved edits
- [x] 4.5 Read-only affordance: lock indicator instead of Edit when not writable

## 5. Verification

- [x] 5.1 Browser E2E (agent-browser): open file → full-size view; edit → save → content on disk; concurrent disk change → conflict banner (+ force-overwrite path, added during E2E); outside writable zone → 🔒 read-only, no Edit button; dirty-close confirm both branches
- [x] 5.2 `npm run build` across workspaces (shared/server/web/embed) passes
- [x] 5.3 Code review agent pass; fix blocking findings (2 HIGH, 1 MEDIUM, 4 LOW — all fixed)
