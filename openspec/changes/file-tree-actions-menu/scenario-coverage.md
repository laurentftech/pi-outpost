# Scenario coverage — file-tree-actions-menu

The tree is exercised by `ui/src/components/FileTree.test.tsx`, which mounts the real `FileTree` and
drives it through its ⋯ menus, right-clicks, modifier clicks, keys and drags, reading back the callbacks
it reports and the rows it highlights (`data-selected`). The menu's order and its "absent, not disabled"
rule are pinned once more, without rendering, in `ui/src/components/fileTreeModel.test.ts`; the menu's
keyboard contract in `ui/src/components/RowMenu.test.tsx`. Server rules are checked on a real filesystem
in `server/test/fileBrowser.test.ts`, over the real socket in `server/test/file-lifecycle.test.mjs`, and
over HTTP in `server/test/files-download.test.mjs`, whose archives are read back by JSZip with every CRC
checked. Expected paths are built with `path.join`, so the Windows CI job compares what the server
resolves.

## Capability: `components` (40 scenarios, modified and added)

| Scenario | Coverage | Assertion evidence |
| --- | --- | --- |
| Cancel a blank file rename | covered | `ui/src/components/FileTree.test.tsx` — "cancels a rename submitted with a blank name": no `onRenameFile`, the input gone, the row back, no error text |
| Confirm a file deletion | covered | `ui/src/components/FileTree.test.tsx` — "sends one delete request only after confirmation": chosen from the menu, `confirm` called with `Delete "readme.md" permanently?`, one `onDeleteFile("readme.md")` |
| ConfirmAFolderDeletion | covered | `ui/src/components/FileTree.test.tsx` — "ConfirmAFolderDeletion: …": `confirm` called with `Delete the folder "src" and everything in it permanently?`, then `onDeleteFile("src")` |
| DragAFolderOntoAWritableFolder | covered | `ui/src/components/FileTree.test.tsx` — "DragAFolderOntoAWritableFolder: …": the drag over its own subfolder leaves it without the drop ring and the drop reports nothing; the drop on `archive` reports `onMoveFile("drafts", "archive")` |
| Cancel a file deletion | covered | `ui/src/components/FileTree.test.tsx` — "does not request deletion when confirmation is cancelled": no `onDeleteFile`, the row still shown |
| Drag a file onto a writable folder | covered | `ui/src/components/FileTree.test.tsx` — "moves a dragged file onto a writable directory": `onMoveFile("readme.md", "src")`, no copy |
| Drag a read-only file onto a writable folder | covered | `ui/src/components/FileTree.test.tsx` — "copies a dragged read-only file onto a writable directory": `effectAllowed` and `dropEffect` are `copy`, `onCopyFile("readme.md", "src")`, no move; folders too in "a read-only folder dropped on a writable one is copied" |
| Do not accept an invalid drop destination | covered | `ui/src/components/FileTree.test.tsx` — "does not accept a drop on a read-only directory": no `onMoveFile` |
| Open a read-only file natively | covered | `ui/src/components/FileTree.test.tsx` — "opens a read-only file with its associated application": the menu has no Rename or Delete, and Open with associated app reports `onOpenNative("readme.md")` |
| Reveal a truncated entry name | covered | `ui/src/components/FileTree.test.tsx` — "keeps the complete entry name available on hover when the row truncates it": `title` holds the full name on a file and a folder |
| AFileRowsMenuInItsOrder | covered | `ui/src/components/FileTree.test.tsx` — "AFileRowsMenuInItsOrder: the rendered menu reads its groups in order": the four `group`s and their items exactly; `ui/src/components/fileTreeModel.test.ts` — same order from `rowActions` |
| AFolderRowsMenu | covered | `ui/src/components/FileTree.test.tsx` — "AFolderRowsMenu: …" (folders at parity): the seven items in order; `ui/src/components/fileTreeModel.test.ts` — "AFolderRowsMenu: …", grouped |
| AReadOnlyFileOffersOnlyWhatItCanTake | covered | `ui/src/components/fileTreeModel.test.ts` — "AReadOnlyFileOffersOnlyWhatItCanTake: …": a read-only file and folder keep Download and Reference, the file Open, and lose Rename, Move, Delete and New; `ui/src/components/FileTree.test.tsx` — "opens a read-only file with its associated application" on the rendered menu |
| TheRootsOfferNoRemoval | covered | `ui/src/components/FileTree.test.tsx` — "TheRootsOfferNoRemoval: …": with `writableRoot: "src"`, the `src` menu has no Rename, Move or Delete but keeps New; `ui/src/components/fileTreeModel.test.ts` likewise |
| TheContextMenuOpensTheSameMenu | covered | `ui/src/components/FileTree.test.tsx` — "TheContextMenuOpensTheSameMenu: …": `fireEvent.contextMenu` answers `false` (the browser's menu prevented) and the menu named `Actions for readme.md` opens with its items |
| TheRowKeepsTheAtAndItsStates | covered | `ui/src/components/FileTree.test.tsx` — "TheRowKeepsTheAtAndItsStates: …": the file row's buttons are exactly the label, `Remove readme.md from the prompt`, `Show diff of readme.md` and `Actions for readme.md`; the folder row's are its `@` and its ⋯; "keeps the @ lit on a referenced row, and reveals it only on hover elsewhere" |
| EachItemCarriesItsSymbol | covered | `ui/src/components/FileTree.test.tsx` — "AFileRowsMenuInItsOrder: …" and "AFolderRowsMenu: …" read each item as symbol and name (`↵ Open` … `× Delete…`, `+ New file or folder…`, `⤓ Download as .zip`); "each menu item carries the symbol of its action" (`@ Remove from prompt`, `⌂ Show in file manager`) |
| TheMenuIsAKeyboardMenu | covered | `ui/src/components/RowMenu.test.tsx` — "TheMenuIsAKeyboardMenu: …": focus on the first item, ArrowDown/Up wrap, Home/End; "Enter on an item runs it; Escape closes…"; `ui/src/components/FileTree.test.tsx` — "TheMenuIsAKeyboardMenu: Escape closes it and focus returns to the row's ⋯" |
| OneMenuAtATime | covered | `ui/src/components/FileTree.test.tsx` — "OneMenuAtATime: …": one `menu` after opening a second row's, none after the tree is replaced by another project's; `ui/src/components/RowMenu.test.tsx` — "OneMenuAtATime: a press outside the menu closes it" |
| ShiftClickSelectsARange | covered | `ui/src/components/FileTree.test.tsx` — "ShiftClickSelectsARange: …": `a`, `b`, `c` selected, `onSelectFile` called once (the plain click only) |
| CtrlClickTogglesOneFile | covered | `ui/src/components/FileTree.test.tsx` — "CtrlClickTogglesOneFile: …": Ctrl adds `b`, Cmd (`metaKey`) removes it, Ctrl adds `d`: `a`, `d` |
| EscapeClearsTheSelection | covered | `ui/src/components/FileTree.test.tsx` — "EscapeClearsTheSelection": nothing selected after Escape on a row |
| ARangeIncludesVisibleFoldersOnly | covered | `ui/src/components/FileTree.test.tsx` — "ARangeIncludesVisibleFoldersOnly: …": `a`, `open`, `b`, `shut`, `z` and not the collapsed folder's entry; a Ctrl-click on a folder neither expands nor fetches it; `ui/src/components/fileTreeModel.test.ts` — `visibleRows` order and exclusion |
| ASelectedFolderCoversItsContent | covered | `ui/src/components/FileTree.test.tsx` — "ASelectedFolderCoversItsContent: …": `src` and "src/main.ts" selected, Delete reports `onDeleteFile("src")` and no batch; `ui/src/components/fileTreeModel.test.ts` — `outermost`; `server/test/file-lifecycle.test.mjs` — the server drops `writable/batch/folder/inner.txt` under its deleted folder too |
| ExpandingAFolderDoesNotSelectIt | covered | `ui/src/components/FileTree.test.tsx` — "ExpandingAFolderDoesNotSelectIt: …": after a plain click opens `box`, the selection is `one` and `three` only, the bar says `2 selected`, and its Delete reports `onDeleteFiles(["box/one", "box/three"])`, never `box` |
| ASelectionDoesNotOutliveItsFiles | covered | `ui/src/components/FileTree.test.tsx` — "ASelectionDoesNotOutliveItsFiles: …": `b` leaves the selection when its listing drops it; nothing is selected after an empty tree and a new one |
| DeleteASelectionWithOneConfirmation | covered | `ui/src/components/FileTree.test.tsx` — "DeleteASelectionWithOneConfirmation: …": one `confirm`, saying the folder's content goes with it, then `onDeleteFiles(["readme.md", "src"])`, no single delete |
| DownloadASelectionAsOneArchive | covered | `ui/src/components/FileTree.test.tsx` — "DownloadASelectionAsOneArchive, …": `onDownload(["readme.md", "src"], false)` once for the selection (and a file as itself, a folder as a zip); `ui/src/util/download.test.ts` — one fetch, one `save` under the server's name |
| DragASelectionOntoAFolder | covered | `ui/src/components/FileTree.test.tsx` — "DragASelectionOntoAFolder: …": `onMoveFiles(["readme.md", "notes.md"], "src")`, no single move |
| AMixedSelectionOffersNoMutation | covered | `ui/src/components/FileTree.test.tsx` — "AMixedSelectionOffersNoMutation: …": no Delete or Move, `Download 2 items as .zip` and `Reference 2 items in prompt` present; `ui/src/components/fileTreeModel.test.ts` likewise |
| TheMenuOfAnUnselectedRowActsOnThatRow | covered | `ui/src/components/FileTree.test.tsx` — "TheMenuOfAnUnselectedRowActsOnThatRow: …": the menu is named `Actions for d`, offers the single `Delete…`, and the earlier selection is gone |
| KeyboardShortcutsOnTheSelection | covered | `ui/src/components/FileTree.test.tsx` — "KeyboardShortcutsOnTheSelection: …": Delete asks `Delete 2 items permanently?` once and reports `onDeleteFiles(["a", "b"])`; F2 opens `Rename c` |
| TheBarAppearsWithASelection | covered | `ui/src/components/FileTree.test.tsx` — "TheBarAppearsWithASelection: …": no `toolbar` for one file, then one named `2 selected`, then `3 selected`, whose buttons are exactly the selected row's menu items plus `Clear the selection` |
| DeleteFromTheBar | covered | `ui/src/components/FileTree.test.tsx` — "DeleteFromTheBar: …": one `confirm` naming the count and the folder, `onDeleteFiles(["a", "d", "z"])`, and no `toolbar` afterwards; "the bar's other actions run on the whole selection too" for Download, Reference and Move to… |
| TheBarClearsTheSelection | covered | `ui/src/components/FileTree.test.tsx` — "TheBarClearsTheSelection": nothing selected, no `toolbar` |
| NoBarForOneEntry | covered | `ui/src/components/FileTree.test.tsx` — "NoBarForOneEntry, and a mixed selection's bar offers no deletion" and "TheBarAppearsWithASelection" (no `toolbar` after a single click); the bar is `sticky` in "stays in view while the tree scrolls" |
| PickADestination | covered | `ui/src/components/FileTree.test.tsx` — "PickADestination: …": the banner says `Moving 2 items: choose a folder`, `archive` is expanded while picking, `Move here: 2026` reports `onMoveFiles(["a", "b"], "archive/2026")`, and the banner goes |
| CancelPicking | covered | `ui/src/components/FileTree.test.tsx` — "CancelPicking: …": Escape and Cancel each end it, no move of either kind reported |
| AReadOnlyFolderIsNoTarget | covered | `ui/src/components/FileTree.test.tsx` — "a read-only folder offers no target while picking, …": no `Move here: ro`, `Move here: inbox` present |
| AMovedFolderIsNoTargetForItself | covered | `ui/src/components/FileTree.test.tsx` — "AReadOnlyFolderIsNoTarget, AMovedFolderIsNoTargetForItself": no `Move here: project` nor `Move here: sub` while moving `project`; `Move here: w` reports `onMoveFile("project", "w")` |

## Capability: `file` (37 scenarios, modified and added)

| Scenario | Coverage | Assertion evidence |
| --- | --- | --- |
| CreateFileFromTree | covered | `ui/src/components/FileTree.test.tsx` — "CreateFileFromTree: New file or folder… opens the input inside the folder": `onCreateFile("src/util.ts")`; the file opening ready to edit is `ui/src/useAgent.test.ts` — "opens the created file, empty and ready to edit" |
| CreateDirectoryFromTree | covered | `ui/src/components/FileTree.test.tsx` — "CreateDirectoryFromTree: …": `onCreateDirectory("src/widgets")`, then, once the server answers `created`, the folder's toggle reads `▾` and its `empty` listing shows; `onSelectFile` never called |
| ReadOnlyDirectoryOffersNothing | covered | `ui/src/components/FileTree.test.tsx` — "ReadOnlyDirectoryOffersNothing: no creation item on a directory outside the writable zone" and "offers nothing at all when the sandbox is read-only — …" (no ⋯ at all on a folder with no action) |
| CancelCreation | covered | `ui/src/components/FileTree.test.tsx` — "cancels on Escape without reporting anything": no creation reported, the input gone |
| RefusedNameKeepsTheInput | covered | `ui/src/components/FileTree.test.tsx` — "keeps the typed name when the server refuses it" and "does not read a listing that already holds the name as success" |
| RevealAFileOnEachPlatform | covered | Unchanged: `server/test/fileBrowser.test.ts` — "RevealAFileOnEachPlatform: …" |
| LinuxFallsBackToTheContainingFolder | covered | Unchanged: `server/test/fileBrowser.test.ts` — "LinuxFallsBackToTheContainingFolder: …" |
| ExplorersExitCodeIsNotAFailure | covered | Unchanged: `server/test/fileBrowser.test.ts` — "ExplorersExitCodeIsNotAFailure: …" |
| RevealIsConfined | covered | Unchanged: `server/test/fileBrowser.test.ts` — "RevealIsConfined: …" |
| TheTreeOffersRevealOnFilesAndFolders | covered | `ui/src/components/FileTree.test.tsx` — "TheTreeOffersRevealOnFilesAndFolders: …": Show in file manager from each row's menu reports `["readme.md"]`, `["docs"]`, nothing expanded; "shows why a reveal failed, on the tree" |
| Rename a writable file | covered | `server/test/fileBrowser.test.ts` — "renames a writable regular file and preserves its content"; `server/test/file-lifecycle.test.mjs` — "renames a file and broadcasts both affected paths" |
| Refuse a rename that would overwrite | covered | `server/test/fileBrowser.test.ts` — "refuses a rename collision without changing either file" |
| Refuse a mutation outside the writable zone | covered | `server/test/fileBrowser.test.ts` — "refuses lifecycle mutations outside the writable zone"; `server/test/file-lifecycle.test.mjs` — "refuses a mutation outside the writable zone under the same request id" |
| Refuse an escaping mutation path | covered | `server/test/fileBrowser.test.ts` — "refuses escaping mutation paths" and "refuses lifecycle mutations through an intermediate symlink outside the root" |
| Move a file into a folder | covered | `server/test/fileBrowser.test.ts` — "moves a file into a writable directory and refuses a collision"; `server/test/file-lifecycle.test.mjs` — "moves a file and broadcasts source and destination branches" |
| Copy a read-only file into a writable folder | covered | `server/test/fileBrowser.test.ts` — "copies a read-only file into a writable directory without removing the source"; `server/test/file-lifecycle.test.mjs` — "copies a read-only file into a writable directory and keeps the source" |
| RenameAFolder | covered | `server/test/fileBrowser.test.ts` — "RenameAFolder: …": nested content readable under `final`, `drafts` gone; `server/test/file-lifecycle.test.mjs` — over the socket, with its `file_changed` |
| DeleteAFolderWithItsContent | covered | `server/test/fileBrowser.test.ts` — "DeleteAFolderWithItsContent: …": the folder gone, the target of the link inside it still holds `kept` |
| MoveAFolder | covered | `server/test/fileBrowser.test.ts` — "MoveAFolder: …": "archive/project/notes.md" readable, the source gone; `server/test/file-lifecycle.test.mjs` — over the socket |
| RefuseMovingAFolderIntoItself | covered | `server/test/fileBrowser.test.ts` — "RefuseMovingAFolderIntoItself: …": into itself and into `self/sub`, both `denied`, content unchanged |
| RefuseReplacingAFolder | covered | `server/test/fileBrowser.test.ts` — "RefuseReplacingAFolder: …": a move onto a non-empty folder and a rename onto an empty one are both `conflict`, all three folders unchanged |
| TheRootsCannotBeRemoved | covered | `server/test/fileBrowser.test.ts` — "TheRootsCannotBeRemoved: …": delete, rename and move of the browser root (no sandbox, whole-root zone) and of the writable root itself are `denied`, nothing changed; `server/test/file-lifecycle.test.mjs` — "the writable root itself cannot be deleted over the socket" |
| DownloadAWorkspaceFile | covered | `server/test/files-download.test.mjs` — "DownloadAWorkspaceFile: …": 20 MB byte for byte, `application/octet-stream`, `nosniff`, `no-store`, `attachment` with `filename*=UTF-8''q3%20r%C3%A9sum%C3%A9.pdf` |
| DownloadAFolderAsAZip | covered | `server/test/files-download.test.mjs` — "DownloadAFolderAsAZip: …": "reports.zip", JSZip with CRC checks finds `reports/`, `reports/empty/`, the memo's text and the 20 MB file's bytes |
| DownloadSeveralEntriesAsOneZip | covered | `server/test/files-download.test.mjs` — "DownloadSeveralEntriesAsOneZip: …": one "files.zip" holding exactly "a.txt", `deep/…`, "logo.png", "notes.md", "notes (2).md" |
| DownloadIsAuthenticated | covered | `server/test/files-download.test.mjs` — "DownloadIsAuthenticated: no token, or a wrong one, gets no byte" (401 with only `{ error: "unauthorized" }`) and "…a token-less server refuses a foreign Host" (403) |
| DownloadIsConfined | covered | `server/test/files-download.test.mjs` — "DownloadIsConfined: …": traversal, absolute, missing and escaping-link paths answer 403/404 without `SECRET`; one escaping path refuses a whole archive |
| DownloadAReadOnlyFile | covered | `server/test/files-download.test.mjs` — "DownloadAReadOnlyFile: …": outside the writable zone, 200 with its text |
| TheTreeDownloadsFromTheServer | covered | `ui/src/components/FileTree.test.tsx` — "DownloadASelectionAsOneArchive, …": a file, a folder and a selection each start one download; `ui/src/util/download.test.ts` — the URL carries the backend origin, every path, the token and the project, a single file goes to the browser without a fetch, an archive is fetched and saved once under the server's name; the bytes arriving are `server/test/files-download.test.mjs` |
| ATooLargeFolderIsRefusedUpFront | covered | `server/test/download.test.ts` — "ATooLargeFolderIsRefusedUpFront: …": past the entry count, past the size, and past the limit shared by a selection, a `too-large` refusal naming it before any archive; `office/test/zipStream.test.ts` — "past 65 535 entries or 4 GiB is refused before anything is written"; `ui/src/util/download.test.ts` — a 413 becomes the message, nothing saved; `ui/src/components/FileTree.test.tsx` — "ATooLargeFolderIsRefusedUpFront, on the tree: …" shows it |
| AnEscapingLinkIsLeftOut | covered | `server/test/files-download.test.mjs` — "AnEscapingLinkIsLeftOut: …": `X-Pi-Outpost-Skipped: 1`, no `SECRET` in the bytes, no entry for the link, the comment starting `1 entry was left out`; `server/test/fileBrowser.test.ts` — the walk's escaping file and folder links and its link cycle; `ui/src/components/FileTree.test.tsx` — the tree says `1 entry was left out of the archive` |
| CopyAReadOnlyFolder | covered | `server/test/fileBrowser.test.ts` — "CopyAReadOnlyFolder: …": `{ path: "copy-workspace/templates", skipped: 0 }`, nested files and the empty folder copied, the source unchanged; `server/test/file-lifecycle.test.mjs` — over the socket |
| ACopyLeavesOutEscapingLinks | covered | `server/test/fileBrowser.test.ts` — "ACopyLeavesOutEscapingLinks: …": `skipped: 1`, no link and no target in the copy; `ui/src/components/FileTree.test.tsx` — "reports a folder copy that left entries out" |
| DeleteSeveralFiles | covered | `server/test/file-lifecycle.test.mjs` — "DeleteSeveralFiles: …": one `file_batch_result` listing the three files and the folder as done (the folder's own file covered by it), all gone, and exactly one `file_changed` for their directory |
| OneRefusalDoesNotStopTheBatch | covered | `server/test/file-lifecycle.test.mjs` — "OneRefusalDoesNotStopTheBatch and ABatchMoveRefusesAnOverwrite": "a.txt" and "c.txt" done after the refused `outside-zone/b.txt` (`denied`, with a message), which is unchanged |
| ABatchMoveRefusesAnOverwrite | covered | Same test: `writable/moves/clash.txt` refused as `conflict`, both files keep `mine` and `theirs` |
| TheTreeReportsWhatWasRefused | covered | `ui/src/useAgent.test.ts` — "sends a batch as one request and reports its refused paths in one sentence": `2 of 3 moved. Not moved: outside/b.txt: …`; `ui/src/components/FileTree.test.tsx` — "TheTreeReportsWhatWasRefused: …" shows that sentence as an alert |

## Capability: `preview-file-attachments` (6 scenarios, modified)

| Scenario | Coverage | Assertion evidence |
| --- | --- | --- |
| User references a file from the tree | covered | `ui/src/components/FileTree.test.tsx` — "User references a file from the tree: …": `onToggleAttachPath("readme.md")` from the menu; `ui/src/App.test.tsx` — "references a file from the tree, and drops it from its referenced marker": the marker appears `aria-pressed` once referenced; "the @ on a row references the file or the folder in one click" |
| Draft mentions a file by hand | covered | Unchanged: `ui/src/components/Composer.test.tsx` — "reports the mentioned paths so the app can attach them" |
| A file is referenced twice | covered | Unchanged: `ui/src/components/Composer.test.tsx` — "does not mention the path twice when the draft already names it" |
| TheMarkerDropsTheReference | covered | `ui/src/components/FileTree.test.tsx` — "TheMarkerDropsTheReference: …": the marker and Remove from prompt each report `onToggleAttachPath("readme.md")`; `ui/src/App.test.tsx` — after the marker the reference is gone from the tree |
| ReferenceAFolder | covered | `ui/src/components/FileTree.test.tsx` — "ReferenceAFolder: …": `onToggleAttachPath("src")`, then `Remove src from the prompt` pressed on its row |
| ReferenceASelection | covered | `ui/src/components/FileTree.test.tsx` — "ReferenceASelection: …": `Reference 3 items in prompt` reports `a` and `c`, not the already referenced `b` |
