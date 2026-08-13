## MODIFIED Requirements

### Requirement: WorkspaceAndGitNavigation

The component layer SHALL provide `FileTree`, `FileViewer`, `Sidebar`, `GitMenu`,
`GitCommitView`, and `GitFileHistory` for workspace and repository navigation. `FileTree` SHALL
derive its presentation from supplied directory, writable-root, Git-status, open-file, and
attachment state. `FileTree` SHALL surface creation of a file or directory only where the supplied
writable-root state says writing is allowed, and SHALL report the requested path through a callback
rather than performing it. `FileViewer` SHALL compose syntax highlighting, copy, diff, markdown, and
workspace-path rendering components, and SHALL offer entry points to both the worktree diff and
the file's history. `GitFileHistory` SHALL derive its presentation from supplied file-history and
revision-pair state. Navigation and mutation requests SHALL be emitted through callbacks.

#### Scenario: SelectWorkspaceFile
- **GIVEN** a directory tree supplied to `FileTree`
- **WHEN** the user selects a file
- **THEN** `FileTree` reports the selected path through its file-selection callback

#### Scenario: RequestFileCreation
- **GIVEN** a writable directory in the tree supplied to `FileTree`
- **WHEN** the user names a new file there and confirms
- **THEN** `FileTree` reports the requested path through its creation callback and creates nothing itself

#### Scenario: RenderFileContent
- **GIVEN** file state supplied to `FileViewer`
- **WHEN** the viewer displays the file
- **THEN** it uses the applicable code, markdown, image, copy, or diff presentation support

#### Scenario: InspectCommit
- **GIVEN** Git status and log state supplied to `GitMenu`
- **WHEN** the user selects a commit
- **THEN** the selected SHA is reported for presentation by `GitCommitView`

#### Scenario: InspectFileHistory
- **GIVEN** file-history state supplied to `GitFileHistory`
- **WHEN** the user picks two revisions
- **THEN** the requested revision pair is reported through its diff-request callback
