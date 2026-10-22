## ADDED Requirements

### Requirement: GitScrollbarOverview
The editor and read-only source SHALL show a right overview rail beside the scrollbar, with added, modified and deleted hunks colored like the left git gutter. Markers SHALL locate changes across the whole document, remain visible for single lines and end deletions, and follow draft, HEAD, layout and file changes. Activating a marker SHALL scroll to that change without editing. No comparable changes SHALL leave no markers.

#### Scenario: DistantChangesInOverview
- **GIVEN** a long file with distant added, modified and deleted hunks
- **WHEN** it is opened
- **THEN** the right rail shows correctly ordered colored markers for all hunks including offscreen ones and a deletion at the end

#### Scenario: NavigateFromOverview
- **WHEN** a marker is clicked or keyboard-activated in editor or read-only source
- **THEN** the matching change scrolls into view without changing or saving the document

#### Scenario: OverviewFollowsCurrentDocument
- **WHEN** the draft is changed or undone, HEAD changes, or the file is closed or switched
- **THEN** the overview reflects only current changes, and absent HEAD or a clean document has no markers

#### Scenario: OverviewSurvivesLayoutChanges
- **WHEN** a file has wrapped lines, an open change peek, scrolling, or a resized editor
- **THEN** the overview stays fixed by the scrollbar with markers positioned against the current document layout, and ordinary scrollbar use still works
