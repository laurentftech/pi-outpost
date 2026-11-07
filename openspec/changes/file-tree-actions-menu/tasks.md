# Tasks

## 1. Folder lifecycle on the server

- [x] 1.1 Refuse rename, move and delete of the browser root and of the writable root itself in `server/src/fileBrowser.ts`, and verify a test for TheRootsCannotBeRemoved
- [x] 1.2 Add the directory branch to rename and move (`lstat` for no destination, `fs.rename`, refuse into itself or a descendant) and verify tests for RenameAFolder, MoveAFolder, RefuseMovingAFolderIntoItself and RefuseReplacingAFolder, with expected paths built by `path.join`
- [x] 1.3 Add the directory branch to delete (`fs.rm` recursive, links removed as links) and verify a DeleteAFolderWithItsContent test whose link target outside the folder still exists afterwards
- [x] 1.4 Add `walkConfined` (lstat, links followed only when they resolve inside the browser root, left-out count) and verify unit tests for nesting, empty folders, an escaping file link, an escaping directory link and a link cycle
- [x] 1.5 Add folder copy over `walkConfined` (mkdir claim, `COPYFILE_EXCL`, left-out count, partial-copy report) and verify tests for CopyAReadOnlyFolder, ACopyLeavesOutEscapingLinks and a refused existing destination
- [x] 1.6 Route the existing single-entry WebSocket handlers to the folder branches and verify the existing lifecycle tests still pass and the new folder tests pass through the wire (`server/test` harness)

## 2. Download and archive

- [x] 2.1 Write the streaming zip writer beside `office/src/zipWriter.ts` (data descriptors, deflate stream, CRC-32, UTF-8 names, entry and size limits) and verify a test that reads its output back with `office/src/zip.ts` and with `jszip`, byte for byte, including an empty folder and a non-ASCII name
- [x] 2.2 Add `GET /files/download` in `server/src/index.ts` (host check, token, one file streamed as is, a folder or several paths as one zip named per the design, `filename*`, `nosniff`, `no-store`, limits checked before the first byte, `X-Pi-Outpost-Skipped`) and verify route tests for every DownloadFromBrowser and ArchivesAreBoundedAndConfined scenario, the large-folder case using a lowered limit
- [x] 2.3 Add `downloadUrl(paths)` beside `rawFileUrl` in `ui/src/util/workspacePath.ts` and a `download(paths)` helper (anchor for one file; fetch, show a refusal, then save for an archive), and verify unit tests for the URL (origin, token, workspace, repeated `path`) and for a refused archive surfacing its message

## 3. Batch delete and move

- [x] 3.1 Add `delete_files`, `move_files` and `file_batch_result` to `shared/src/protocol.ts` and verify `npm run typecheck` passes
- [x] 3.2 Implement the batch handlers in `server/src/index.ts` over the single-entry helpers (continue after a refusal, no rollback, one `file_changed` per affected directory) and verify server tests for DeleteSeveralFiles (files and a folder), OneRefusalDoesNotStopTheBatch and ABatchMoveRefusesAnOverwrite
- [x] 3.3 Add `deleteFiles` / `moveFiles` and the batch `fileOperation` variant in `ui/src/useAgent.ts`, wire them through `Sidebar.tsx` and `App.tsx`, and verify `useAgent` tests for a batch result with refused paths and for the open file closing when it, or a folder holding it, is deleted

## 4. Tree state lift

- [x] 4.1 Move folder open state from `TreeNode` into `FileTree` (one set of open paths, cleared on a browser-root change) and verify the existing `FileTree.test.tsx` and `Sidebar` tests pass unchanged
- [x] 4.2 Add pure `visibleRows(tree, openPaths)` and `outermost(paths)` and verify unit tests for display order, folders included, collapsed children excluded, and a child dropped under its selected folder

## 5. Actions menu

- [x] 5.1 Add the pure `rowActions(entry, context)` returning ordered groups, and verify unit tests for AFileRowsMenuInItsOrder, AFolderRowsMenu, AReadOnlyFileOffersOnlyWhatItCanTake, TheRootsOfferNoRemoval and a selection-wide variant (counts, mixed selection)
- [x] 5.2 Build `RowMenu` (menu/menuitem roles, arrow keys, Home/End, Enter, Escape, focus return, outside click, flip/clamp inside the panel) and verify component tests for TheMenuIsAKeyboardMenu and OneMenuAtATime
- [x] 5.3 Replace the row icons in `FileTree.tsx` with the `⋯` control and the context menu on file and folder rows, keep the git badge and the referenced marker, make folder rows renameable, deletable and draggable, and verify `FileTree.test.tsx` for OnlyStatesStayOnTheRow, TheContextMenuOpensTheSameMenu, the lifecycle scenarios (delete confirm/cancel, ConfirmAFolderDeletion, DragAFolderOntoAWritableFolder, open natively), TheTreeOffersRevealOnFilesAndFolders, CreateFileFromTree via the menu, ReadOnlyDirectoryOffersNothing, and the reference scenarios including ReferenceAFolder and TheMarkerDropsTheReference

## 6. Multi-selection and destination picking

- [x] 6.1 Add selection to `FileTree` (anchor, Shift range over visible rows, Ctrl/Cmd toggle without opening or expanding, Escape, pruning on listing and project change) and verify tests for every FileTree multi-selection scenario
- [x] 6.2 Make the menu act on the normalised selection (count in labels, unselected row becomes the selection, Delete with one confirmation, one archive for Download, Reference once per entry) and the drag of a selected row move the selection, and verify tests for FileTree acts on a selection, ASelectedFolderCoversItsContent and ReferenceASelection
- [x] 6.3 Add Move to… picking mode (banner with Cancel, writable folders and root as targets except a moved folder and its descendants, folders still expand, Escape) and verify tests for PickADestination, CancelPicking, AReadOnlyFolderIsNoTarget and AMovedFolderIsNoTargetForItself
- [x] 6.4 Show a batch result and an archive's left-out count in the tree, and verify tests for TheTreeReportsWhatWasRefused and AnEscapingLinkIsLeftOut on the tree side

## 7. Documentation

- [x] 7.1 Update `docs/features.md` (file tree menu, reference, Download and archives, selection, folder operations) and the tree mentions in `docs/how-to.md`, and verify every changed sentence matches the shipped labels and links resolve

## 8. Integration checks

- [x] 8.1 Write `openspec/changes/file-tree-actions-menu/scenario-coverage.md` mapping every scenario of the three delta specs to its test, and verify `npm run check:scenarios` passes
- [x] 8.2 Rebuild `web`, `@pi-outpost/embed` and `build:e2e-host`, run `npm run bench`, and drive the tree with Playwright on 127.0.0.1:4321 at 224 px and full width: open the menu by `⋯` and right-click on files and folders, download a file and a folder and check the saved bytes and archive entries, Shift/Ctrl-select files and folders and delete and move them, rename a folder, pick a destination; then a break-it pass (double clicks, menu left open while switching project, deleting a selected folder on disk, moving a folder while its child is open in the viewer, acting while a batch is pending) and read back the DOM and filesystem after each burst
- [ ] 8.3 Run `npm run typecheck`, `npm run lint`, the server, office and ui suites, and `openspec validate file-tree-actions-menu --strict`, and verify all pass

## Workflow follow-up

- Archive the change once the PR is merged and the scenario matrix is complete.
