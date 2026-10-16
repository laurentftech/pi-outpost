## ADDED Requirements

### Requirement: MermaidActionsMatchOtherDiagrams

Mermaid SHALL show a visible action row below its picture, with the same action
styling as structured-exchange diagrams. Its source and orientation controls SHALL
remain available. A rendered Mermaid diagram SHALL offer download SVG inline and
in its full-size view. The file SHALL be standalone SVG with dimensions, readable
text labels and its own appearance.
Full-size diagram actions SHALL stay at the bottom left of the frame while only
the content scrolls. The close control SHALL stay at the top right.

#### Scenario: MermaidActionsMatchOtherDiagrams
- **WHEN** a Mermaid diagram finishes rendering
- **THEN** its actions are visible below the picture without hovering
- **AND** the full-size view also offers download SVG

#### Scenario: DownloadTheShownMermaid
- **GIVEN** a reader has turned a Mermaid diagram
- **WHEN** they download SVG
- **THEN** the SVG uses the direction shown and contains the diagram's labels
- **AND** the authored source remains unchanged

#### Scenario: EnlargedDiagramActionsStayFixed
- **GIVEN** a full-size diagram wider than its frame
- **WHEN** the reader scrolls the content horizontally or vertically
- **THEN** the actions stay at the bottom left of the frame and remain clickable
- **AND** the close control stays accessible

#### Scenario: FailedMermaidDownloadCanBeRetried
- **WHEN** producing the SVG fails
- **THEN** the error is reported, the diagram remains available and download can be retried

#### Scenario: AMermaidDownloadCannotOutliveItsSource
- **WHEN** download is requested repeatedly while an export is pending
- **THEN** only one export runs
- **AND** replacing the source before it completes prevents the obsolete file from downloading
