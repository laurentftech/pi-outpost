## 1. Protocol

- [x] 1.1 Add `create_file` and `create_directory` to `ClientMessage` in `shared/src/protocol.ts` (`path`, `requestId`), documented as the creation counterpart of `write_file` — which keeps refusing a missing path (design D1).
- [x] 1.2 Confirm no new `FileBrowserErrorReason` is needed: `denied`, `conflict`, `outside-root`, `not-found` already cover every refusal creation can produce.

## 2. Server

- [x] 2.1 Add `assertCreatableName(name)` to `server/src/fileBrowser.ts`: refuse a segment containing `/` or `\`, equal to `.` or `..`, empty, whitespace-only, or carrying a NUL (design D3).
- [x] 2.2 Add `createFileFromBrowser(root, writableRel, relPath)` beside `writeFileFromBrowser`, running the same checks in the same order (read-only sandbox → `resolveConfined` → writable zone) and creating with `fs.writeFile(resolved, "", { flag: "wx" })` — one syscall, no TOCTOU gap. Map `EEXIST` to `conflict`, `ENOENT` to `not-found`. Return size and mtime.
- [x] 2.3 Add `createDirectoryFromBrowser(...)` with the same checks and `fs.mkdir(resolved)` — no `recursive`, one directory at a time.
- [x] 2.4 Handle both messages in `server/src/index.ts`: answer `file_written` (file) or a parent listing (directory) under the request id, and broadcast `file_changed` so every connected tree refreshes through the existing machinery.
- [x] 2.5 Tests in `server/test/fileBrowser.test.ts`: creation inside the writable zone; refused outside it; refused on a read-only sandbox; refused through a symlink pointing out of the root; refused on an existing path (file **and** directory) with the existing content untouched; refused for `..`, `a/b`, `""` and `"   "`; missing parent reported as not-found.
- [x] 2.6 Test that `write_file` still refuses a path that does not exist — the guard this change deliberately does not touch.

## 3. Client transport

- [x] 3.1 Add `createFile(path)` and `createDirectory(path)` actions to `ui/src/useAgent.ts`, mirroring `writeFile`'s request-id convention.
- [x] 3.2 On the answer: for a file, open it in the viewer with the returned size and mtime so the editor can save without a read round trip (design D5); for a directory, expand it in the tree.
- [x] 3.3 Keep the refusal on the creation input rather than surfacing it as a viewer error: route the `file_browser_error` for a `create:` request id into the tree's creation state.
- [x] 3.4 Tests in `ui/src/useAgent.test.ts`: both messages are sent with the right shape; the file answer opens the viewer; a refusal lands on the creation state and opens nothing.

## 4. Tree UI

- [x] 4.1 Add a `+` control to directory rows in `ui/src/components/FileTree.tsx`, only when `isReadOnly(fullPath, writableRoot)` is false, following the `@` control's reveal rule (hover where hovering exists, always on touch).
- [x] 4.2 Render an input row as the directory's first child at its indentation, with the placeholder `name, or name/ for a folder`. Enter confirms, Escape and blur cancel.
- [x] 4.3 Interpret a trailing `/` as a directory request and everything else as a file (design D4); trim surrounding whitespace before deciding.
- [x] 4.4 Show a refusal next to the input, keeping the typed name so it can be corrected.
- [x] 4.5 Thread `onCreateFile`/`onCreateDirectory` through `Sidebar.tsx` to `App.tsx`.
- [x] 4.6 Tests in `ui/src/components/FileTree.test.tsx`: the control is absent on a read-only directory and on files; confirming reports the joined path through the callback; a trailing slash reports a directory; Escape reports nothing; a refusal keeps the input and its text.

## 5. Verification

- [x] 5.1 Full server suite and coverage gate (lines 92 / branches 86 / functions 90).
- [x] 5.2 Full UI suite and coverage gate (lines 91 / branches 85 / functions 93).
- [x] 5.3 `openspec validate add-file-creation-from-tree --strict`.
- [x] 5.4 Manually verify: create a file in a nested directory and type in it straight away; create a directory and create a file inside it; try a name that already exists; try `../escape`; try both in a read-only sandbox and confirm the control is absent. *Done in the running app: file created and opened in edit mode, directory created and listed, duplicate refused with the input and its text kept (that round found a real bug — see the design amendment). `../escape` and the read-only sandbox are covered by the server and tree tests rather than by hand.*
- [ ] 5.5 Manually verify the control on a touch-sized viewport, where it must be visible without hover.
