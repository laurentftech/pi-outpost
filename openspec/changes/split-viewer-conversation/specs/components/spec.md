# Spec Delta

## MODIFIED Requirements

### Requirement: FileTree row actions menu

Each file and folder row SHALL carry one actions menu, opened by a `⋯` control or by the row's context menu. Besides it the row SHALL carry only the git badge and the `@` reference toggle. The `⋯` and an unreferenced `@` SHALL follow the hover/touch convention. Items SHALL be labelled, each with its action's symbol, and grouped in a fixed order; an item the row cannot take SHALL be left out rather than disabled.

#### Scenario: AFileRowsMenuInItsOrder
- **GIVEN** a writable, git-modified file with every callback wired
- **WHEN** the user opens its actions menu
- **THEN** the items read, in order and grouped: Open, Show diff, Open with associated app, Show in file manager · Reference in prompt, Copy relative path, Copy absolute path, Download · Rename…, Move to… · Delete…

#### Scenario: AFolderRowsMenu
- **GIVEN** a writable folder row with every callback wired
- **WHEN** the user opens its actions menu
- **THEN** the items read, in order and grouped: New file…, New folder…, Show in file manager · Reference in prompt, Copy relative path, Copy absolute path, Download as .zip · Rename…, Move to… · Delete…

#### Scenario: AReadOnlyFileOffersOnlyWhatItCanTake
- **GIVEN** a read-only file, and a read-only folder
- **WHEN** the user opens each one's actions menu
- **THEN** Rename…, Move to…, Delete…, New file… and New folder… are absent, and Download, Reference in prompt and both Copy path items are present on both, and Open on the file

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
- **THEN** each item shows its action's symbol beside its label — ↵ open, ± diff, ↗ open with app, ⌂ show in file manager, + new, @ reference, ⧉ copy path, ⤓ download, ✎ rename, → move, × delete

#### Scenario: TheMenuIsAKeyboardMenu
- **GIVEN** an open actions menu
- **WHEN** the user moves with the arrow keys, presses Enter, or presses Escape
- **THEN** focus moves between items, Enter runs the focused item, Escape closes the menu, and focus returns to the row

#### Scenario: OneMenuAtATime
- **GIVEN** an open actions menu
- **WHEN** the user opens another row's menu, clicks outside it, or the listed project changes
- **THEN** the first menu is closed

#### Scenario: CopyARowsPaths
- **GIVEN** the file `docs/a.md` in a project whose root is `/home/u/proj` on the server
- **WHEN** the user chooses Copy relative path, then Copy absolute path
- **THEN** the clipboard holds `docs/a.md`, then `/home/u/proj/docs/a.md`, and each copy is briefly confirmed

#### Scenario: AnAbsolutePathUsesTheServersSeparator
- **GIVEN** a project whose root is `C:\Users\u\proj` on a Windows server
- **WHEN** the user copies the absolute path of `docs/a.md`
- **THEN** the clipboard holds `C:\Users\u\proj\docs\a.md`

### Requirement: FileTree acts on a selection

The actions menu of a selected row SHALL act on the whole selection and say how many entries it covers; the menu of an unselected row SHALL first make that row the selection. On a selection it SHALL offer Delete…, Move to…, Download and Reference in prompt, each only when every selected entry can take it, and Copy relative paths and Copy absolute paths, which copy one path per line. Delete SHALL ask one confirmation naming the count. Download SHALL fetch one archive. Dropping a selected row on a folder SHALL move the selection.

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
- **THEN** Delete… and Move to… are absent, and Download, Reference in prompt and both Copy paths items are present

#### Scenario: TheMenuOfAnUnselectedRowActsOnThatRow
- **GIVEN** a selection of `a` and `b`
- **WHEN** the user opens the actions menu of `d`
- **THEN** the selection becomes `d` alone and the menu acts on `d`

#### Scenario: KeyboardShortcutsOnTheSelection
- **GIVEN** a focused selected row in a selection of writable entries
- **WHEN** the user presses Delete
- **THEN** the same single confirmation is asked as from the menu, and F2 on a single focused writable file or folder opens its rename

#### Scenario: CopyASelectionsPaths
- **GIVEN** `a.md` and `docs` selected
- **WHEN** the user chooses Copy relative paths
- **THEN** the clipboard holds `a.md` and `docs`, one per line

## ADDED Requirements

### Requirement: TopBarSpansTheWindow

The application header SHALL span the full width of the window, above the Files sidebar and the main content, whether the sidebar is open or closed and whether a file is shown side by side with the conversation. The Files sidebar SHALL start below the header. Opening, closing or resizing the sidebar SHALL NOT move or narrow the header.

#### Scenario: HeaderAboveTheFilesSidebar
- **GIVEN** the Files sidebar is open
- **THEN** the header starts at the left edge of the window and the sidebar starts below it

#### Scenario: HeaderStaysOnOneRowWhenSplit
- **GIVEN** a wide window with a file shown side by side with the conversation
- **THEN** the header controls fit on the one row they share, unaffected by the width of the conversation pane

#### Scenario: HeaderMenusOverlayThePanes
- **GIVEN** the Files sidebar open and a file shown side by side
- **WHEN** the user opens a header menu (project, sessions, settings)
- **THEN** the menu is drawn above the sidebar, the viewer and the conversation, and is fully usable

### Requirement: NoSidewaysScrollOnNarrowScreens

No layout of the application SHALL make the page scroll sideways: the file viewer's toolbar and the composer's status row SHALL wrap rather than overflow, and below the md breakpoint the Files sidebar SHALL be a drawer over the content rather than a column beside it. Opening a file, a diff or a search hit from that drawer SHALL close it.

#### Scenario: APhoneShowsTheWholeViewer
- **GIVEN** a 390-pixel-wide window with a file open
- **THEN** the page is no wider than the window and every viewer action is on screen

#### Scenario: TheDrawerGetsOutOfTheWay
- **GIVEN** a window below the md breakpoint with the Files drawer open
- **WHEN** the user opens a file from it
- **THEN** the drawer closes and the file is shown at full width

#### Scenario: ANarrowConversationColumnWraps
- **GIVEN** a file beside the conversation with the Files sidebar open on a laptop-sized window
- **THEN** the composer's model, confinement and usage controls wrap within the conversation column and the page does not scroll sideways

### Requirement: FileTreeOpensOnDoubleClick

Opening a file can now change the whole layout, so a plain mouse click on a file row SHALL select it without opening it. A double-click, Enter on the focused row, or a tap on a touch screen SHALL open it. The git badge, the Open item of the actions menu and a search hit SHALL still open with one activation. A plain click on a folder SHALL still expand or collapse it.

#### Scenario: AClickSelectsADoubleClickOpens
- **GIVEN** a file row in the tree
- **WHEN** the user clicks it once
- **THEN** the row is selected and nothing is opened
- **AND WHEN** the user double-clicks it
- **THEN** the file is opened

#### Scenario: EnterOpensTheFocusedFile
- **GIVEN** a focused file row
- **WHEN** the user presses Enter
- **THEN** the file is opened

#### Scenario: ATapOpens
- **GIVEN** a touch screen
- **WHEN** the user taps a file row
- **THEN** the file is opened, without waiting for a second tap

#### Scenario: OneActivationStillOpensFromTheBadgeAndTheMenu
- **WHEN** the user clicks a file's git badge, or chooses Open in its actions menu
- **THEN** the diff, or the file, is opened at once

### Requirement: SecondaryHeaderControlsFold

So that the header keeps one row on narrow screens without hiding or clipping anything, below the lg breakpoint the secondary controls (Outcome, the git branch, the conversation filter, the HTML export, the terminal, the theme and the conversation tree) — and below the sm breakpoint the session list — SHALL wait behind a ⋯ control that shows them on the rows after it, as themselves, with their own menus. The project, Files, new session and settings controls SHALL stay on the row.

#### Scenario: APhoneHeaderIsOneRow
- **GIVEN** a 390-pixel-wide window
- **THEN** the header is one row holding the project, Files, new session, ⋯ and settings controls, none of them off screen

#### Scenario: TheFoldedControlsAreAtHand
- **GIVEN** a narrow window
- **WHEN** the user opens ⋯ and then the sessions menu
- **THEN** the folded controls are shown, and the sessions menu opens whole inside the window
