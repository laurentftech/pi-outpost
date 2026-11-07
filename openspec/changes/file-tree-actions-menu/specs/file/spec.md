# Spec Delta

## MODIFIED Requirements

### Requirement: CreateFromTree

The frontend SHALL let the user create a file or a directory from the file tree, in a directory the
tree shows as writable. The affordance SHALL be the New file or folder… item of the directory's
actions menu, and the workspace root's own control above the listing; it SHALL NOT be offered on a
directory outside the writable zone.

The name SHALL be entered in the tree itself, at the directory it will be created in, so the
destination is shown rather than typed. Confirming SHALL request creation; cancelling SHALL leave
the tree as it was.

A created file SHALL open in the viewer, ready to be edited. A created directory SHALL be expanded
instead. A refusal SHALL be reported next to the input, which SHALL keep what the user typed so a
rejected name can be corrected rather than retyped.

#### Scenario: CreateFileFromTree
- **GIVEN** a directory inside the writable zone
- **WHEN** the user chooses New file or folder… in its actions menu, types a name and confirms
- **THEN** the file is created in that directory and opens in the viewer ready to be edited

#### Scenario: CreateDirectoryFromTree
- **WHEN** the user creates a directory this way
- **THEN** it appears in the tree, expanded, and no viewer opens

#### Scenario: ReadOnlyDirectoryOffersNothing
- **GIVEN** a directory outside the writable zone, or a read-only sandbox
- **THEN** its actions menu offers no New file or folder… item

#### Scenario: CancelCreation
- **WHEN** the user cancels the input
- **THEN** nothing is created and the tree returns to its previous state

#### Scenario: RefusedNameKeepsTheInput
- **WHEN** creation is refused, because the name is taken or not usable
- **THEN** the reason is shown next to the input and the typed name is still there to correct

### Requirement: RevealInFileManager

The system SHALL ask the host operating system's file manager to show an existing file or folder
inside the browser root, selected in its containing folder: with `open -R` on macOS, with
`explorer.exe /select,` on Windows, and elsewhere with the `org.freedesktop.FileManager1.ShowItems`
D-Bus method, falling back to opening the containing folder with `xdg-open` when that call fails.
It SHALL invoke these without a shell and with the validated absolute path. Revealing SHALL not
require the path to be writable. If the path is outside the browser root or does not exist, the
system SHALL report an error and SHALL not launch anything; if the file manager cannot be started,
it SHALL report an error. The Files tree SHALL offer Show in file manager in the actions menu of
every file and folder row.

#### Scenario: RevealAFileOnEachPlatform
- **GIVEN** `docs/report.docx` exists inside the browser root
- **WHEN** the browser asks to reveal it
- **THEN** macOS runs `open -R` with its absolute path, Windows runs `explorer.exe` with `/select,` and its absolute path, and Linux calls `ShowItems` with its `file://` URI

#### Scenario: LinuxFallsBackToTheContainingFolder
- **GIVEN** no file manager answers the `ShowItems` call
- **WHEN** a file is revealed on Linux
- **THEN** its containing folder is opened with `xdg-open`

#### Scenario: ExplorersExitCodeIsNotAFailure
- **WHEN** `explorer.exe` exits with a non-zero code after starting
- **THEN** the reveal is reported as done, and a failure to start it is reported as an error

#### Scenario: RevealIsConfined
- **WHEN** the browser asks to reveal a path outside the browser root, a traversal path, or a path that does not exist
- **THEN** the request is refused with an error and nothing is launched

#### Scenario: TheTreeOffersRevealOnFilesAndFolders
- **GIVEN** the Files tree shows a folder and a file
- **WHEN** the user chooses Show in file manager in either row's actions menu
- **THEN** the browser sends a reveal request for that row's path, and a failure is shown on the tree

### Requirement: File lifecycle operations are confined and permissioned

The system SHALL rename, delete, move, and copy an existing regular file or directory only after resolving every supplied path with the file browser's symlink-safe confinement rules. Rename, delete, and move SHALL require the source to be inside the writable zone. Copy SHALL allow a confined read-only source because it leaves that source unchanged. Move and copy SHALL require the destination directory to be inside the writable zone. A rename name SHALL be one non-empty path segment other than `.` or `..`; rename, move, and copy SHALL refuse an existing destination and SHALL NOT overwrite it. Deleting a directory SHALL delete everything inside it, removing a symbolic link as a link and never following it. A directory SHALL NOT be moved into itself or one of its descendants. The browser root and the writable root itself SHALL NOT be renamed, moved or deleted. On success, the system SHALL notify connected clients of the affected tree paths.

#### Scenario: Rename a writable file
- **GIVEN** `draft.docx` is an existing regular file in a writable directory
- **WHEN** the browser requests its rename to `final.docx`
- **THEN** `final.docx` exists, `draft.docx` no longer exists, and connected clients are notified of the change

#### Scenario: Refuse a rename that would overwrite
- **GIVEN** `draft.docx` and `final.docx` already exist in the same writable directory
- **WHEN** the browser requests to rename `draft.docx` to `final.docx`
- **THEN** the request is refused as a conflict and both original files remain unchanged

#### Scenario: Refuse a mutation outside the writable zone
- **WHEN** a browser requests to rename, delete, or move a file outside the writable zone or while the sandbox is read-only
- **THEN** the request is refused as denied and no file is changed

#### Scenario: Refuse an escaping mutation path
- **WHEN** a rename, delete, or move source or destination escapes the browser root by traversal or symlink resolution
- **THEN** the request is refused and no file is changed

#### Scenario: Move a file into a folder
- **GIVEN** `inbox/report.docx` is writable and `archive` is an existing writable directory
- **WHEN** the browser requests to move `inbox/report.docx` to `archive`
- **THEN** `archive/report.docx` exists, the source no longer exists, and connected clients are notified of both affected tree branches

#### Scenario: Copy a read-only file into a writable folder
- **GIVEN** `reference/report.docx` is confined to the browser root but outside the writable zone, and `workspace/archive` is writable
- **WHEN** the browser requests to copy `reference/report.docx` to `workspace/archive`
- **THEN** the file exists at both paths, and connected clients are notified for the destination branch

#### Scenario: RenameAFolder
- **GIVEN** a writable folder `drafts` holding files and subfolders
- **WHEN** the browser requests its rename to `final`
- **THEN** `final` holds the same content, `drafts` no longer exists, and clients are notified of the parent directory

#### Scenario: DeleteAFolderWithItsContent
- **GIVEN** a writable folder `old` holding files, a subfolder, and a symbolic link to a file outside it
- **WHEN** the browser requests its deletion
- **THEN** `old` and everything inside it are gone, and the link's target is untouched

#### Scenario: MoveAFolder
- **GIVEN** writable folders `inbox/project` and `archive`
- **WHEN** the browser requests to move `inbox/project` to `archive`
- **THEN** `archive/project` holds its content and `inbox/project` no longer exists

#### Scenario: RefuseMovingAFolderIntoItself
- **WHEN** the browser requests to move `project` into `project` or `project/sub`
- **THEN** the request is refused and nothing is changed

#### Scenario: RefuseReplacingAFolder
- **GIVEN** `archive/project` already exists
- **WHEN** the browser requests to move or rename another folder to `archive/project`
- **THEN** the request is refused as a conflict and both folders keep their content

#### Scenario: TheRootsCannotBeRemoved
- **WHEN** the browser requests to rename, move or delete the browser root, or the writable root itself
- **THEN** the request is refused and nothing is changed

## ADDED Requirements

### Requirement: DownloadFromBrowser

The server SHALL serve as a download, authenticated like `/files/raw` and confined by the same symlink-safe resolution: a regular file as itself, a directory as a `.zip`, several paths as one `.zip`. It SHALL stream, with no preview size ceiling, as an attachment named after the entry (`application/octet-stream`, `nosniff`). Writability SHALL NOT be required. A missing or escaping path SHALL be refused.

#### Scenario: DownloadAWorkspaceFile
- **GIVEN** `reports/q3 résumé.pdf` of 20 MB exists inside the browser root
- **WHEN** an authenticated client requests its download
- **THEN** it receives the exact bytes, as an attachment named `q3 résumé.pdf`, never rendered inline

#### Scenario: DownloadAFolderAsAZip
- **GIVEN** a folder `reports` holding files and a subfolder
- **WHEN** its download is requested
- **THEN** the client receives `reports.zip`, whose entries are the folder's files under `reports/` with their bytes intact, empty subfolders included

#### Scenario: DownloadSeveralEntriesAsOneZip
- **GIVEN** the paths `a.txt`, `docs` and `img/logo.png`
- **WHEN** their download is requested together
- **THEN** one `.zip` holds `a.txt`, `docs/…` and `logo.png` at its top level

#### Scenario: DownloadIsAuthenticated
- **WHEN** a download is requested without a valid token, or with a foreign Host header
- **THEN** it is refused and no byte of the file is sent

#### Scenario: DownloadIsConfined
- **WHEN** a download is requested for a traversal path, a symlink leading outside the browser root, or a path that does not exist
- **THEN** it is refused and nothing outside the browser root is read

#### Scenario: DownloadAReadOnlyFile
- **GIVEN** a file inside the browser root but outside the writable zone
- **WHEN** its download is requested
- **THEN** it is served

#### Scenario: TheTreeDownloadsFromTheServer
- **GIVEN** pi-outpost runs on another machine than the browser
- **WHEN** the user chooses Download on a file, a folder, or a selection
- **THEN** the browser saves one file — the file itself, or one `.zip` — fetched from the server

### Requirement: ArchivesAreBoundedAndConfined

An archive's entries SHALL be collected before its first byte is sent. An archive past 65 535 entries or 4 GiB SHALL be refused with a message naming the limit, and no partial archive SHALL be sent. An entry that resolves outside the browser root SHALL be left out, and the archive SHALL say how many were.

#### Scenario: ATooLargeFolderIsRefusedUpFront
- **GIVEN** a folder holding more than 65 535 entries
- **WHEN** its download is requested
- **THEN** the response is an error naming the limit, not a truncated archive, and the tree shows that message

#### Scenario: AnEscapingLinkIsLeftOut
- **GIVEN** a folder holding a file and a symbolic link to a file outside the browser root
- **WHEN** its download is requested
- **THEN** the archive holds the file, not the link's target, and says that one entry was left out

### Requirement: CopyAFolder

Copying a directory SHALL copy everything inside it into the destination directory under its own name, with the confinement of the single-file copy. Entries that resolve outside the browser root SHALL be left out and counted in the result. The copy SHALL refuse an existing destination and SHALL NOT overwrite it.

#### Scenario: CopyAReadOnlyFolder
- **GIVEN** `reference/templates` is outside the writable zone and `workspace` is writable
- **WHEN** the browser requests to copy `reference/templates` to `workspace`
- **THEN** `workspace/templates` holds the same files and subfolders, and `reference/templates` is unchanged

#### Scenario: ACopyLeavesOutEscapingLinks
- **GIVEN** a folder holding a symbolic link that resolves outside the browser root
- **WHEN** it is copied
- **THEN** the copy does not hold the link nor its target, and the result says one entry was left out

### Requirement: Deleted entries can be restored

A file or folder deleted from the browser SHALL be moved into a trash the server keeps outside every workspace, in a place the agent cannot read, and the answer SHALL carry a restore token. Restoring SHALL put the entry back at its path, with the rules of a move, never overwriting. The trash SHALL be emptied when the server starts, and of anything older than 24 hours.

#### Scenario: DeleteThenRestore
- **GIVEN** a writable folder `old` holding files, deleted from the browser
- **WHEN** the browser asks to restore it with the token the deletion returned
- **THEN** `old` is back with the same content, and connected clients are notified

#### Scenario: RestoreRefusesAnOverwrite
- **GIVEN** `notes.md` deleted, then a new `notes.md` created at the same path
- **WHEN** the deletion is restored
- **THEN** the restore of `notes.md` is refused as a conflict and the new file is unchanged

#### Scenario: TheTrashIsOutsideTheWorkspace
- **WHEN** a file is deleted from the browser
- **THEN** it is in no listing of the browser root, and its bytes are under the server's own data directory, which the agent's tools cannot read

#### Scenario: ATokenFromElsewhereRestoresNothing
- **WHEN** a restore names an unknown token, a token already used, or a token of another project
- **THEN** that token is refused and nothing is written

#### Scenario: TheTrashIsEmptied
- **GIVEN** entries in the trash
- **WHEN** the server starts, or an entry is older than 24 hours
- **THEN** that entry is erased for good and can no longer be restored

### Requirement: Batch file lifecycle operations

The system SHALL delete, or move to one directory, several files and directories in one request, applying to each path the rules of the single-entry operations. It SHALL go on after a refused path, SHALL roll nothing back, SHALL report each path as done or refused with its reason, and SHALL notify connected clients once for the affected tree paths.

#### Scenario: DeleteSeveralFiles
- **GIVEN** three writable regular files and a writable folder
- **WHEN** the browser requests their deletion in one request
- **THEN** none of them exists, the result lists all four as done, and clients are notified once

#### Scenario: OneRefusalDoesNotStopTheBatch
- **GIVEN** a batch move of `a.txt`, `outside/b.txt` (outside the writable zone) and `c.txt` to `archive`
- **WHEN** the server handles it
- **THEN** `a.txt` and `c.txt` are in `archive`, `outside/b.txt` is unchanged, and the result names it as refused with its reason

#### Scenario: ABatchMoveRefusesAnOverwrite
- **GIVEN** `archive/a.txt` already exists
- **WHEN** a batch moves `a.txt` into `archive`
- **THEN** `a.txt` is reported refused as a conflict and neither file changes

#### Scenario: TheTreeReportsWhatWasRefused
- **WHEN** a batch from the tree comes back with refused paths
- **THEN** the tree states how many files were done and names each refused file with its reason
