# Spec Delta

## MODIFIED Requirements

### Requirement: FileTree lifecycle controls

`FileTree` SHALL expose callbacks for opening a file natively, renaming a file or folder, deleting a file or folder, moving a writable file or folder to a directory, and copying a read-only file or folder to a writable directory; it SHALL not perform filesystem operations itself. For a writable file or folder, it SHALL offer rename and delete in the row's actions menu. Submitting a blank inline rename SHALL cancel the edit, restore the existing row, and report no rename request. It SHALL show a confirmation naming the target before reporting a delete request — for a folder, saying that everything inside it is deleted too — and cancellation SHALL report no request. It SHALL make a regular file or folder row draggable and accept it only on a directory row that is a valid writable destination other than the dragged folder or one of its descendants, reporting a move for a writable source and a copy for a read-only source. It SHALL offer native opening in the actions menu of any listed file inside the browser root, including a read-only file.

Every truncated file or directory label SHALL expose its complete entry name through the same hover tooltip convention used by the Git tree.

#### Scenario: Cancel a blank file rename
- **GIVEN** a writable file whose inline rename field is open
- **WHEN** the user clears the field and submits it
- **THEN** `FileTree` reports no rename request and restores the existing file row without an error

#### Scenario: Confirm a file deletion
- **GIVEN** a writable file in `FileTree`
- **WHEN** the user chooses Delete in its actions menu and confirms the dialog
- **THEN** `FileTree` reports one delete request for that file through its callback

#### Scenario: ConfirmAFolderDeletion
- **GIVEN** a writable folder in `FileTree`
- **WHEN** the user chooses Delete in its actions menu
- **THEN** the confirmation names the folder and says that everything inside it is deleted, and confirming reports one delete request for that folder

#### Scenario: DragAFolderOntoAWritableFolder
- **GIVEN** a writable folder row `drafts` and a writable folder row `archive`
- **WHEN** the user drops `drafts` on `archive`, and then tries to drop `drafts` on one of its own subfolders
- **THEN** `FileTree` reports one move of `drafts` to `archive`, and the drop on its subfolder is not accepted

#### Scenario: Cancel a file deletion
- **WHEN** the user cancels the deletion confirmation
- **THEN** `FileTree` reports no delete request and keeps the file row displayed

#### Scenario: Drag a file onto a writable folder
- **GIVEN** a file row and a writable destination directory row
- **WHEN** the user drops the file row on that directory
- **THEN** `FileTree` reports the source file and destination directory through its move callback

#### Scenario: Drag a read-only file onto a writable folder
- **GIVEN** a read-only regular file row and a writable directory row
- **WHEN** the user drops the file row on that directory
- **THEN** `FileTree` reports the source file and destination directory through its copy callback and indicates a copy drag effect

#### Scenario: Do not accept an invalid drop destination
- **GIVEN** a file row and a read-only directory row
- **WHEN** the user attempts to drop the file on that directory
- **THEN** `FileTree` does not report a move request

#### Scenario: Open a read-only file natively
- **GIVEN** a read-only file row
- **WHEN** the user chooses Open with associated app in its actions menu
- **THEN** `FileTree` reports the file path through its native-open callback

#### Scenario: Reveal a truncated entry name
- **GIVEN** a file or directory name is too long for the fixed-width Files panel
- **WHEN** the user hovers the truncated label
- **THEN** the browser tooltip exposes the complete entry name

## ADDED Requirements

### Requirement: FileTree row actions menu

Each file and folder row SHALL carry one actions menu, opened by a `⋯` control or by the row's context menu. Besides it the row SHALL carry only the git badge and the `@` reference toggle. The `⋯` and an unreferenced `@` SHALL follow the hover/touch convention. Items SHALL be labelled, each with its action's symbol, and grouped in a fixed order; an item the row cannot take SHALL be left out rather than disabled.

#### Scenario: AFileRowsMenuInItsOrder
- **GIVEN** a writable, git-modified file with every callback wired
- **WHEN** the user opens its actions menu
- **THEN** the items read, in order and grouped: Open, Show diff, Open with associated app, Show in file manager · Reference in prompt, Download · Rename…, Move to… · Delete…

#### Scenario: AFolderRowsMenu
- **GIVEN** a writable folder row with every callback wired
- **WHEN** the user opens its actions menu
- **THEN** the items read, in order and grouped: New file or folder…, Show in file manager · Reference in prompt, Download as .zip · Rename…, Move to… · Delete…

#### Scenario: AReadOnlyFileOffersOnlyWhatItCanTake
- **GIVEN** a read-only file, and a read-only folder
- **WHEN** the user opens each one's actions menu
- **THEN** Rename…, Move to…, Delete… and New file or folder… are absent, and Download and Reference in prompt are present on both, and Open on the file

#### Scenario: TheRootsOfferNoRemoval
- **GIVEN** the folder row that is the writable root itself
- **WHEN** the user opens its actions menu
- **THEN** Rename…, Move to… and Delete… are absent

#### Scenario: TheContextMenuOpensTheSameMenu
- **WHEN** the user right-clicks a row
- **THEN** the same actions menu opens at the pointer instead of the browser's own

#### Scenario: TheRowKeepsTheAtAndItsStates
- **GIVEN** a referenced, git-modified file and an unreferenced folder
- **THEN** the file's row shows the lit `@`, the git badge and `⋯`, the folder's row its `@` and `⋯`, and no other control

#### Scenario: EachItemCarriesItsSymbol
- **WHEN** the user opens a row's actions menu
- **THEN** each item shows its action's symbol beside its label — ↵ open, ± diff, ↗ open with app, ⌂ show in file manager, + new, @ reference, ⤓ download, ✎ rename, → move, × delete

#### Scenario: TheMenuIsAKeyboardMenu
- **GIVEN** an open actions menu
- **WHEN** the user moves with the arrow keys, presses Enter, or presses Escape
- **THEN** focus moves between items, Enter runs the focused item, Escape closes the menu, and focus returns to the row

#### Scenario: OneMenuAtATime
- **GIVEN** an open actions menu
- **WHEN** the user opens another row's menu, clicks outside it, or the listed project changes
- **THEN** the first menu is closed

### Requirement: FileTree multi-selection

`FileTree` SHALL let the user select several file and folder rows: Shift-click SHALL select every visible row between the anchor and the clicked row, Ctrl/Cmd-click SHALL add or remove one row, and Escape SHALL clear the selection. These clicks SHALL NOT open a file nor expand a folder. An entry inside a selected folder SHALL be covered by it and acted on once. A path that leaves the listing SHALL leave the selection.

#### Scenario: ShiftClickSelectsARange
- **GIVEN** files `a`, `b`, `c`, `d` listed in that order and `a` clicked
- **WHEN** the user Shift-clicks `c`
- **THEN** `a`, `b` and `c` are selected, `d` is not, and the open file is unchanged

#### Scenario: CtrlClickTogglesOneFile
- **GIVEN** a selection of `a` and `b`
- **WHEN** the user Ctrl-clicks (Cmd-clicks on macOS) `b` and then `d`
- **THEN** the selection is `a` and `d`

#### Scenario: EscapeClearsTheSelection
- **GIVEN** a selection of several files
- **WHEN** the user presses Escape in the tree
- **THEN** nothing is selected

#### Scenario: ARangeIncludesVisibleFoldersOnly
- **GIVEN** an expanded folder between two files, and a collapsed folder whose entries are not shown
- **WHEN** the user Shift-clicks across them
- **THEN** every visible row in between is selected, both folder rows included, and none of the collapsed folder's entries

#### Scenario: ASelectedFolderCoversItsContent
- **GIVEN** the folder `docs` and the file `docs/a.md` are both selected
- **WHEN** the user deletes, moves, downloads or references the selection
- **THEN** the request carries `docs` once and not `docs/a.md`

#### Scenario: ASelectionDoesNotOutliveItsFiles
- **GIVEN** a selection including `b`
- **WHEN** `b` is deleted, or another project is listed
- **THEN** `b`, or the whole selection, is no longer selected

### Requirement: FileTree acts on a selection

The actions menu of a selected row SHALL act on the whole selection and say how many entries it covers; the menu of an unselected row SHALL first make that row the selection. On a selection it SHALL offer Delete…, Move to…, Download and Reference in prompt, each only when every selected entry can take it. Delete SHALL ask one confirmation naming the count. Download SHALL fetch one archive. Dropping a selected row on a folder SHALL move the selection.

#### Scenario: DeleteASelectionWithOneConfirmation
- **GIVEN** two writable files and one writable folder selected
- **WHEN** the user chooses Delete 3 items… and confirms once
- **THEN** `FileTree` reports one batch delete request for the three paths, and the confirmation says the folder's content goes with it

#### Scenario: DownloadASelectionAsOneArchive
- **GIVEN** a file and a folder selected
- **WHEN** the user chooses Download
- **THEN** one download is started, for one `.zip` holding both

#### Scenario: DragASelectionOntoAFolder
- **GIVEN** two writable files selected and a writable folder
- **WHEN** the user drags one of the selected rows onto the folder
- **THEN** `FileTree` reports one batch move of both paths to that folder

#### Scenario: AMixedSelectionOffersNoMutation
- **GIVEN** a selection holding a writable and a read-only file
- **WHEN** the user opens the menu of a selected row
- **THEN** Delete… and Move to… are absent, and Download and Reference in prompt are present

#### Scenario: TheMenuOfAnUnselectedRowActsOnThatRow
- **GIVEN** a selection of `a` and `b`
- **WHEN** the user opens the actions menu of `d`
- **THEN** the selection becomes `d` alone and the menu acts on `d`

#### Scenario: KeyboardShortcutsOnTheSelection
- **GIVEN** a focused selected row in a selection of writable entries
- **WHEN** the user presses Delete
- **THEN** the same single confirmation is asked as from the menu, and F2 on a single focused writable file or folder opens its rename

### Requirement: FileTree destination picking

Move to… SHALL put the tree in a destination-picking mode that names what is being moved: every writable folder row other than a moved folder or its descendants, and the workspace root, SHALL become a target; clicking one SHALL report the move and leave the mode; Escape or a Cancel control SHALL leave it without a request. Folders SHALL still expand while picking.

#### Scenario: PickADestination
- **GIVEN** two writable files and Move to… chosen on them
- **WHEN** the user expands `archive` and clicks `archive/2026`
- **THEN** `FileTree` reports one move of both files to `archive/2026` and the tree leaves picking mode

#### Scenario: CancelPicking
- **GIVEN** the tree is picking a destination
- **WHEN** the user presses Escape or Cancel
- **THEN** no move is reported and the tree is back to normal

#### Scenario: AReadOnlyFolderIsNoTarget
- **GIVEN** the tree is picking a destination
- **THEN** a read-only folder cannot be clicked as a target

#### Scenario: AMovedFolderIsNoTargetForItself
- **GIVEN** the tree is picking a destination for the folder `project`
- **THEN** neither `project` nor any folder inside it can be clicked as a target
