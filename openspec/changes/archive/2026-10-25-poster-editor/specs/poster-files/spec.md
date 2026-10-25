## Purpose

Posters in pi-outpost: ordinary project files the agent writes with its own file tools, opened by the file viewer in the poster editor and saved back to the file.

## ADDED Requirements

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
