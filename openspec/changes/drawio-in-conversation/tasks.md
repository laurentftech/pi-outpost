# Tasks

## 1. Splice and frame protocol

- [x] 1.1 `spliceDrawioPage(fileText, pageIndex, modelXml)` in `ui/src/util`. It replaces one `<diagram>`'s content and writes a compressed page out plain. The model's own attributes come back from the frame (1.2). Verify with unit tests: several pages (the others byte-identical), a compressed page, a bare `<mxGraphModel>` file, and ids kept.
- [x] 1.2 Frame page (`drawioPage.ts`) gains touch-up mode:
  - messages `EDIT`, `SAVE`, `UNDO`, `REDO` and `EXPORT_SVG`, answered by `CHANGED`, `SAVED` and `SVG`;
  - re-enable the graph, drop the viewer's `click` override, undo manager, keys;
  - the `common.css` rules in the frame's `<style>`;
  - leaving the mode redraws from the last text.

  Verify with unit tests on the generated page: CSP and sandbox unchanged, origin checks kept, and the editing globals present in the vendored viewer.
- [x] 1.3 `DrawioFrame` exposes the mode, save, undo/redo and SVG export to its parent. Verify with component tests on a fake frame. Assert only messages the real page sends (reread `drawioPage.ts`; the fake must not be kinder than the frame).

## 2. One block, its controls and the full-size view

- [x] 2.1 `DrawioBlock`:
  - `DIAGRAM_ACTIONS` row: ⤢ enlarge, ⤓ download SVG (named after the file and page), ⤓ download .drawio, ↗ open in a reply, open in draw.io where offered;
  - `EnlargedView` with the same downloads.

  Verify with component tests for each control and the download names.
- [x] 2.2 Touch-up in the block, outside replies and in the full-size view:
  - save, undo, redo, done;
  - "done" and close ask before discarding unsaved edits;
  - the save goes through `onSave(path, content, expectedMtimeMs)` recorded at touch-up start;
  - a conflict is shown, and the touch-up stays open.

  Verify with component tests: save content, the conflict path, the discard prompt, and read-only outside touch-up.
- [x] 2.3 `FileViewer`'s rendered `.drawio` mode uses `DrawioBlock`, and its split and source modes are unchanged. Verify that the existing `FileViewer.drawio.test.tsx` still passes, plus a test for touch-up from the viewer.

## 3. In the conversation

- [x] 3.1 `useAgent` exposes `onFileChanged(path, cb)` from the existing `file_changed` handling. Verify with a unit test: only subscribers for that path are called, and unsubscribe works.
- [x] 3.2 `MarkdownImg` sends a `.drawio` source to `DrawioBlock` (reply variant):
  - the text is fetched through `rawFileUrl`;
  - the block refetches on `onFileChanged`;
  - it mounts near the viewport;
  - it says so, naming the file, when the file is missing or unreadable;
  - `App` passes its save function so touch-up works from the full-size view.

  Verify with component tests: drawn, missing file, unreadable file, refetch after a change.
- [x] 3.3 Exports: a `.drawio` picture reference becomes a link naming the file in the HTML and Word conversation exports. Verify with export unit tests, checking there is no `<img>`/picture lookup for it.

## 4. Agent guidance

- [x] 4.1 `skills/drawio/SKILL.md` step 4 says to show the checked diagram with `![name](./path.drawio)`. `drawio_check`'s `promptGuidelines` say the same. Verify with tests on the tool's guidelines and the bundled skill text.

## 5. Verification

- [x] 5.1 Running app (rebuild web, embed and the e2e host first; bench plus a fake-RPC transcript referencing a `.drawio`). Check:
  - the diagram is drawn in a reply;
  - enlarge, both downloads, and open;
  - touch-up from the viewer and from the full-size view: move, reconnect, new wire, rename, delete, undo/redo, save, then read the file back from disk;
  - a conflict made by changing the file underneath;
  - no network request from the frame.

  Read back the DOM and the files, not screenshots.
- [x] 5.2 Monkey pass:
  - double-click save;
  - "done" mid-edit;
  - switch project during touch-up;
  - delete the file while it is drawn;
  - close the full-size view with unsaved edits;
  - several diagrams in one reply;
  - stream a reply that references a diagram.

  Report what broke and fix it.
- [x] 5.3 One live agent run (short): ask for a draw.io diagram and check from the session transcript that the reply references it and that it is drawn.
- [x] 5.4 Send a downloaded SVG to the user for a check in desktop Word (labels shown).
- [ ] 5.5 `scenario-coverage.md` with every scenario covered, `npm run check:scenarios`, `openspec validate --strict`, lint, and suites; documentation impact (README, `docs/`, the skills README).

## Workflow follow-up

- Archive the change from `main` after the PR merges, never from the feature branch.
