## MODIFIED Requirements

### Requirement: WorkspaceAndGitNavigation

The component layer SHALL provide `FileTree`, `FileViewer`, `Sidebar`, `GitMenu`,
`GitCommitView`, and `GitFileHistory` for workspace and repository navigation. `FileTree` SHALL
derive its presentation from supplied directory, writable-root, Git-status, open-file, and
attachment state. `FileViewer` SHALL compose syntax highlighting, copy, diff, markdown, and
workspace-path rendering components, and SHALL offer entry points to both the worktree diff and
the file's history. `GitFileHistory` SHALL derive its presentation from supplied file-history and
revision-pair state. Navigation and mutation requests SHALL be emitted through callbacks.

#### Scenario: SelectWorkspaceFile
- **GIVEN** a directory tree supplied to `FileTree`
- **WHEN** the user selects a file
- **THEN** `FileTree` reports the selected path through its file-selection callback

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

## ADDED Requirements

### Requirement: SharedGraphPrimitives

The component layer SHALL render the conversation tree and the file-history graph from one set of
lane primitives — lane geometry, palette, and the rail drawing — so the two read as one visual
language. The rail SHALL take its palette as a parameter, so a graph whose highlighted line always
holds the first lane and one whose highlight moves between lanes can each be coloured correctly
without duplicating the drawing. Lane layout SHALL be computed by pure functions, separately from
rendering.

#### Scenario: OneRailForBothGraphs
- **GIVEN** the conversation tree and the file-history graph
- **WHEN** either renders a row
- **THEN** both draw it with the same lane width, row height, node shapes, and fork curves

#### Scenario: PaletteIsSuppliedByTheGraph
- **WHEN** a graph marks the highlighted line per row rather than by lane
- **THEN** it supplies a palette that never yields the reserved color, so no other lane can claim it

#### Scenario: LayoutIsTestableWithoutRendering
- **WHEN** lane assignment is exercised
- **THEN** it can be computed and asserted without mounting a component
