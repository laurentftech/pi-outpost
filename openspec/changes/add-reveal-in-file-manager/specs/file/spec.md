## ADDED Requirements

### Requirement: RevealInFileManager

The system SHALL ask the host operating system's file manager to show an existing file or folder
inside the browser root, selected in its containing folder: with `open -R` on macOS, with
`explorer.exe /select,` on Windows, and elsewhere with the `org.freedesktop.FileManager1.ShowItems`
D-Bus method, falling back to opening the containing folder with `xdg-open` when that call fails.
It SHALL invoke these without a shell and with the validated absolute path. Revealing SHALL not
require the path to be writable. If the path is outside the browser root or does not exist, the
system SHALL report an error and SHALL not launch anything; if the file manager cannot be started,
it SHALL report an error. The Files tree SHALL offer the control on every file and folder row.

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
- **WHEN** the user presses Show in file manager on either row
- **THEN** the browser sends a reveal request for that row's path, and a failure is shown on the tree

## MODIFIED Requirements

### Requirement: Native file opening is confined

The system SHALL request that the host operating system open a selected existing regular file inside the browser root with its associated application. It SHALL invoke the platform launcher without a shell and with the validated absolute path as an argument, and SHALL NOT start it hidden. Native opening SHALL not require the file to be writable. If the path is outside the browser root, is not a regular file, or the platform launcher fails, the system SHALL report an error and SHALL not launch an application for an unvalidated path. On Windows, where `explorer.exe` exits with a non-zero code even when it has opened the file, only a failure to start it SHALL be reported as an error.

#### Scenario: Open a Word document natively
- **GIVEN** `report.docx` is an existing file inside the browser root and Word is its associated application
- **WHEN** the browser requests native opening for `report.docx`
- **THEN** the system asks the host platform to open that validated file with its associated application

#### Scenario: Refuse native opening outside the browser root
- **WHEN** the browser requests native opening for an absolute path outside the browser root or a traversal path
- **THEN** the request is refused and no platform launcher is invoked

#### Scenario: OpeningOnWindowsIsShownAndNotMisreported
- **GIVEN** the server runs on Windows and a CSV file is inside the browser root
- **WHEN** the browser requests native opening for it
- **THEN** `explorer.exe` is started with the file and without the hidden-window flag, and its non-zero exit code is not reported as a failure
