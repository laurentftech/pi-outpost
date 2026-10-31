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

### Requirement: AProjectPictureIsInserted

In pi-outpost, the poster editor's Insert menu SHALL offer the project's pictures (SVG, PNG, JPEG,
GIF and WebP files). The chosen one SHALL be put in the poster as a picture, into the selected
picture frame or onto the page, carrying `data-picture-file`. An SVG SHALL be kept as its own SVG;
a raster SHALL be scaled as a picture chosen from the person's computer is. A file that cannot be
read or is no picture SHALL be named with its reason, and the poster left unchanged.

#### Scenario: TheProjectsPicturesAreOffered
- **GIVEN** a project holding an SVG figure and a PNG
- **WHEN** the person opens Insert, then Picture from the project
- **THEN** both are offered, as paths from the poster's directory

#### Scenario: AnSvgStaysVector
- **WHEN** the person chooses an SVG of the project
- **THEN** the picture holds that SVG itself, not a raster of it, in the SVG's proportions

#### Scenario: ARasterIsScaled
- **WHEN** the person chooses a PNG wider than 1200 pixels
- **THEN** the picture is a PNG at most 1200 pixels wide

### Requirement: AFrameNamingAProjectPictureIsFilledOnOpen

An empty picture frame carrying `data-picture-file` SHALL be filled with that file when the poster
opens in pi-outpost's editor, unsaved until the person saves it, under the same rules as a frame naming a
diagram: resolved from the poster's directory or the root, read within the server's read zone, a
filled frame left as it is, a file that cannot be read leaving its frame empty and named.

#### Scenario: AFigureTheAgentWroteFillsItsFrame
- **GIVEN** a poster with an empty frame naming an SVG figure of the project
- **WHEN** the poster opens in the editor
- **THEN** the frame shows the figure as its SVG, the poster has unsaved changes, and once saved the file holds it

#### Scenario: AMissingPictureLeavesTheFrameEmpty
- **GIVEN** a frame naming a file that does not exist, and one naming a file that is no picture
- **WHEN** the poster opens
- **THEN** both frames stay empty and the editor names each with its reason

### Requirement: TheAgentIsTaughtPictureFrames

pi-outpost's posters skill SHALL tell the agent to put a picture file of the project in a poster
through an empty frame naming it, the figures it writes with `write_structure_figure` among them,
and never to paste an SVG into the markup.

#### Scenario: TheSkillNamesPictureFrames
- **WHEN** the agent reads the posters skill
- **THEN** it learns `data-picture-file`, that the editor fills the frame, and that its own figures go in this way

### Requirement: TheAgentChecksThePostersItWrites

pi-outpost SHALL give the agent a `poster_check` tool that reads a `.poster.html` within the read
zone, writes nothing, and reports errors (what the editor refuses or does not draw) and warnings
(what reads badly), each saying what to write instead, or that the poster has no defect. The tool's
prompt guideline SHALL ask for a check after every write or edit of a poster, whether or not the
posters skill was read. The tool SHALL be published by the SDK, sandbox and RPC runtimes alike.

#### Scenario: APageThatIsNotAPosterIsNamed
- **GIVEN** a `.poster.html` without the `poster-format` meta, the `<style data-poster>` stylesheet or the `<div class="poster-page">`
- **WHEN** the agent checks it
- **THEN** the report is an error naming the missing marker and pointing to the skeleton

#### Scenario: AFileTheEditorWouldNotDrawIsNamed
- **GIVEN** a poster whose markup holds `<img src="../docs/architecture.drawio">`, `<img src="../figures/car.svg">` and `<img src="https://example.org/a.png">`, and whose stylesheet holds `url(../figures/car.svg)`
- **WHEN** the agent checks it
- **THEN** each is an error: the diagram's says the empty frame to write with `data-drawio` and that path, the SVG's the frame with `data-picture-file`, the web picture's that a poster fetches nothing, and the stylesheet's names the `url()`

#### Scenario: WhatTheEditorRemovesIsNamed
- **GIVEN** a poster holding an `onclick` attribute, an `<iframe>` and a `<link>`
- **WHEN** the agent checks it
- **THEN** each is an error saying the editor removes it

#### Scenario: AFrameNamingSomethingMissingIsNamed
- **GIVEN** frames naming a diagram that does not exist, a page the diagram does not have, a picture file that does not exist, a file that is not a picture, and a path leaving the read zone
- **WHEN** the agent checks the poster
- **THEN** each frame is an error naming its path and why it cannot be filled, and no file outside the read zone is opened

#### Scenario: AWellFormedPosterPasses
- **GIVEN** a poster written from the skeleton, with an empty frame naming an existing diagram page and one naming an existing SVG figure
- **WHEN** the agent checks it
- **THEN** the report says the poster has no defect, gives its format, and lists both frames as filled when the poster is opened

#### Scenario: WarningsDoNotFailThePoster
- **GIVEN** a poster with text inside an SVG drawing, a drawing over 50 kB, and a `.poster-page` size that is not its format's
- **WHEN** the agent checks it
- **THEN** each is a warning saying what to change, and the report says the poster opens

#### Scenario: TheAgentChecksAPosterItWrote
- **WHEN** the person asks a live model for a poster holding a draw.io diagram and an SVG figure of the project
- **THEN** the model runs `poster_check` on the poster it wrote, and the poster it hands over opens in the editor with both pictures drawn

### Requirement: FramesFilledOnOpenAreNotThePersonsTouchUps

Frames the editor fills when a poster opens SHALL make Save available, and SHALL NOT by
themselves make the viewer ask before dropping the poster: dropped, they are filled again on the
next opening. A touch-up the person makes, before or after the frames are filled, SHALL still be
asked about. The editor SHALL say the filled pictures are drawn from the project and that saving
keeps them in the file.

#### Scenario: LeavingAFilledPosterAsksNothing
- **GIVEN** a poster whose frames name a draw.io diagram and a picture file of the project
- **WHEN** the person opens it, the frames are filled, and the person leaves the rendered view without touching anything
- **THEN** Save was available, nothing is asked, and the file on disk is unchanged

#### Scenario: AFilledPosterTouchedUpIsAskedAbout
- **GIVEN** the same poster, opened and its frames filled
- **WHEN** the person corrects a text and leaves the rendered view
- **THEN** the viewer asks before dropping the touch-up

### Requirement: AShownPosterFollowsItsFile

A poster open in the editor SHALL show its file's new version when the file changes on disk,
unless the editor holds unsaved touch-ups: those SHALL be kept, and once the editor holds none
(it says it is clean, or they are discarded) it SHALL show the file as it is then. The person's
own save SHALL NOT reopen the editor.

#### Scenario: AnAgentRewriteIsShown
- **GIVEN** a poster open in the editor with no unsaved touch-ups
- **WHEN** the agent rewrites the file
- **THEN** the editor shows the new version, and a save is checked against its time

#### Scenario: UnsavedTouchUpsAreKeptOverARewrite
- **GIVEN** a poster open in the editor with unsaved touch-ups
- **WHEN** the agent rewrites the file
- **THEN** the editor keeps the touch-ups and is not reopened, and saving them is refused
- **AND** once the editor holds no touch-ups any more, it shows the agent's version

#### Scenario: OwnSaveDoesNotReopen
- **WHEN** the person saves and the file is read back as written
- **THEN** the editor is not reopened

### Requirement: ASaveIsCheckedAgainstTheVersionShown

A save SHALL be checked against the modification time of the version the editor shows, never a
later one, so that a write landing after that version was read refuses the save instead of being
overwritten by it.

#### Scenario: ASaveIsCheckedAgainstTheShownVersion
- **GIVEN** the file was rewritten after the version shown was read, and before the editor opened
- **WHEN** the person saves
- **THEN** the save is checked against the shown version's time, and so refused
