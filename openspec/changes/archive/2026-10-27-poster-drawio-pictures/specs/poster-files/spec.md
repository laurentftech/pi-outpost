## ADDED Requirements

### Requirement: ADrawioDiagramIsInsertedAsAPicture

In pi-outpost, the poster editor's Insert menu SHALL offer the project's draw.io diagrams with
their pages. The chosen page SHALL be drawn by draw.io's viewer and put in the poster as an SVG
picture: into the selected picture frame, or onto the page. The picture SHALL carry
`data-drawio` and `data-drawio-page`. A diagram that cannot be read or drawn SHALL be named with
its reason, and the poster left unchanged.

#### Scenario: TheProjectsDiagramsAreOffered
- **GIVEN** a project holding draw.io diagrams, one of two pages
- **WHEN** the person opens Insert, then draw.io diagram
- **THEN** each diagram is offered, and each page of the two-page one

#### Scenario: ADiagramGoesIntoTheSelectedFrame
- **GIVEN** an empty picture frame selected
- **WHEN** the person chooses a diagram's page
- **THEN** the frame shows that page as an SVG picture, labels drawn, and names the diagram and page

#### Scenario: ADiagramGoesOntoThePage
- **GIVEN** nothing selected
- **WHEN** the person chooses a diagram
- **THEN** a picture of it is placed on the page, in the diagram's proportions

#### Scenario: AnUnreadableDiagramSaysWhy
- **WHEN** the chosen file is not a draw.io diagram the viewer can draw
- **THEN** the editor says so, naming the file, and the poster is unchanged

### Requirement: AFrameNamingADiagramIsFilledOnOpen

An empty picture frame carrying `data-drawio` SHALL be filled with that diagram's page when the
poster opens in pi-outpost's editor, unsaved until the person saves it. The reference SHALL resolve against
the poster's directory, or the workspace root when it starts with `/`, and SHALL be read within
the server's read zone. A frame already holding a picture SHALL be left as it is. A frame whose
diagram cannot be read or drawn SHALL stay empty, and the editor SHALL say which.

#### Scenario: AnAgentsFrameIsFilledOnOpen
- **GIVEN** a poster the agent wrote with an empty frame naming a diagram beside it
- **WHEN** the poster opens in the editor
- **THEN** the frame shows the diagram, the poster has unsaved changes, and once saved the file holds the picture

#### Scenario: TheNamedPageIsDrawn
- **GIVEN** a frame naming the second page of a two-page diagram, by name or by number
- **WHEN** the poster opens
- **THEN** the frame shows that page, not the first

#### Scenario: AFilledFrameIsLeftAlone
- **GIVEN** a frame naming a diagram and already holding a picture
- **WHEN** the poster opens
- **THEN** its picture is unchanged and the poster has no unsaved changes

#### Scenario: AMissingDiagramLeavesTheFrameEmpty
- **GIVEN** a frame naming a diagram that does not exist, or one outside the read zone
- **WHEN** the poster opens
- **THEN** the frame stays empty and the editor names the diagram it could not draw

#### Scenario: ADiagramSurvivesTheExport
- **GIVEN** a frame filled with a diagram
- **WHEN** the poster is exported to Word
- **THEN** the page picture shows the diagram, its labels drawn

### Requirement: TheAgentIsTaughtDiagramFrames

pi-outpost's posters skill SHALL tell the agent to put a draw.io diagram in a poster through an
empty picture frame naming it, and never to copy a diagram's SVG into the markup.

#### Scenario: TheSkillNamesDiagramFrames
- **WHEN** the agent reads the posters skill
- **THEN** it learns `data-drawio` and `data-drawio-page`, that the editor fills the frame, and not to inline the SVG
