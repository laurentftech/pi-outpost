# poster-files Specification

## Purpose
Posters in pi-outpost: ordinary project files the agent writes with its own file tools, opened by the file viewer in the poster editor and saved back to the file.

## Requirements

### Requirement: TheAgentWritesPostersAsFiles

The agent SHALL be taught the poster format by a bundled skill carrying the shared guide, and SHALL write a poster as a `.poster.html` file with its ordinary file tools, the file viewer being where the person sees it.

#### Scenario: TheAgentMakesAPoster
- **WHEN** the person asks the agent for a poster of the class rules
- **THEN** a `.poster.html` file appears in the project, and the agent points the person to it

### Requirement: TheFileViewerOpensThePosterEditor

The file viewer SHALL open a `.poster.html` file in the poster editor, and SHALL also offer its source; a file that is not a readable poster SHALL say why and show its source.

#### Scenario: APosterFileOpensInTheEditor
- **WHEN** a `.poster.html` file is opened
- **THEN** it is drawn in the poster editor, and the source mode is offered

#### Scenario: ABrokenPosterSaysWhy
- **WHEN** a `.poster.html` file cannot be read as a poster
- **THEN** the viewer says why and shows its source, rather than an empty editor

### Requirement: SavingWritesTheFile

Saving in the editor SHALL write the poster back to its file within the project's write zone, and SHALL be refused when the file changed on disk since it was opened, or when the file lies outside the write zone.

#### Scenario: TouchUpsReachTheAgent
- **WHEN** the person corrects a text and saves
- **THEN** the file on disk holds the correction, and the agent's next read of it returns it

#### Scenario: AFileChangedOnDiskIsNotOverwritten
- **GIVEN** the poster open in the editor, and the agent rewrote the file since
- **WHEN** the person saves
- **THEN** the save is refused and the editor says the file changed, and the agent's version is kept

#### Scenario: AReadOnlyPosterIsNotSaved
- **WHEN** a poster outside the write zone is opened
- **THEN** the editor offers no save, and export still works

### Requirement: ExportsDownloadInTheBrowser

Exporting to Word or PowerPoint in pi-outpost SHALL download the file in the browser under the poster's name.

#### Scenario: APowerPointExportDownloads
- **WHEN** the person exports a poster to PowerPoint
- **THEN** the browser downloads a `.pptx` named after the poster

### Requirement: SwitchingAwayDropsTheEditor

Opening another file or project while a poster is open SHALL close its editor, and nothing it was doing SHALL save or draw under the new context.

#### Scenario: ASaveInFlightDoesNotLandElsewhere
- **GIVEN** a save started in a poster's editor
- **WHEN** the person switches project before it answers
- **THEN** the answer changes nothing shown for the new project, and no other file is written

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

### Requirement: ADiagramInAPosterIsTouchedUpFromIt

In pi-outpost, double-clicking a picture naming a draw.io diagram (`data-drawio`) SHALL open that diagram's named page for touch-up over the poster, with the touch-ups the file viewer offers and a way to open it in draw.io desktop. The poster SHALL stay open beneath, unchanged until the touch-up is closed. A diagram that cannot be read SHALL be named with its reason, and nothing opened.

#### Scenario: DoubleClickOpensTheDiagramsPage
- **GIVEN** a poster holding a picture of the second page of a two-page diagram
- **WHEN** the person double-clicks the picture
- **THEN** that page opens for touch-up over the poster, not the first page and not a file chooser

#### Scenario: TheDiagramCanGoToDrawioDesktop
- **WHEN** the person asks, from the touch-up, to open the diagram in draw.io desktop
- **THEN** the diagram's file is opened with draw.io desktop, where the server can

#### Scenario: AMissingDiagramSaysWhy
- **GIVEN** a picture naming a diagram that no longer exists
- **WHEN** the person double-clicks it
- **THEN** the editor names the diagram it could not open, and the picture is unchanged

### Requirement: TheTouchedUpPageReplacesItsPictures

Closing a diagram's touch-up after it was saved SHALL put the page as now drawn into every picture of the poster showing that page, as unsaved changes. Each picture SHALL keep its place and width, its height following the page's new proportions. Closed without a save, the poster SHALL be unchanged.

#### Scenario: TheSavedPageReplacesThePicture
- **GIVEN** a diagram opened from the poster, a box moved and the diagram saved
- **WHEN** the touch-up is closed
- **THEN** the picture shows the box at its new place, at the same place and width in the poster, and the poster has unsaved changes

#### Scenario: EveryPictureOfThePageIsReplaced
- **GIVEN** two pictures of the same page, and one of another page of the same diagram
- **WHEN** that page is touched up from one of them, saved and closed
- **THEN** both pictures of that page show the new drawing, and the other page's picture is unchanged

#### Scenario: ATallerPageKeepsTheWidth
- **GIVEN** a page that became taller in the touch-up
- **WHEN** it replaces its picture
- **THEN** the picture keeps its width and grows in height, in the page's new proportions

#### Scenario: NothingSavedNothingChanged
- **GIVEN** a diagram opened from the poster and touched up but not saved
- **WHEN** the person closes it and agrees to drop the touch-ups
- **THEN** the pictures and the poster are unchanged, with no unsaved changes

### Requirement: TheTouchUpFollowsItsFile

While a diagram is open for touch-up from a poster, a change saved to its file from elsewhere — draw.io desktop, the agent — SHALL be drawn in it, unless it holds unsaved touch-ups; and closing it SHALL put the page as saved last into the poster.

#### Scenario: ASaveFromDrawioDesktopReachesThePoster
- **GIVEN** a diagram opened from the poster and, from it, in draw.io desktop
- **WHEN** a box is moved in draw.io desktop and saved, then the touch-up is closed
- **THEN** the touch-up showed the moved box, and the poster's picture shows it too
