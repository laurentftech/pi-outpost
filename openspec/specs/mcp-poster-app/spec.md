# mcp-poster-app Specification

## Purpose
The Claude Desktop extension "Posters (pi-outpost)": posters kept in a folder the person picks, composed by Claude through tools and retouched by the person in an editor drawn in the conversation.

## Requirements

### Requirement: PostersLiveInTheChosenFolder

The extension SHALL ask at installation for a folder, keep each poster there as its `.poster.html` file and every revision in a hidden folder beside it, and start without error when no poster exists yet. It SHALL be installable beside the plannings extension, the two sharing a folder without disturbing each other.

#### Scenario: EveryRevisionIsKept
- **WHEN** a poster is created and then changed twice
- **THEN** its file holds the latest version, and revisions 1 to 3 can each be read

#### Scenario: PlanningsAndPostersShareAFolder
- **GIVEN** the plannings extension and this one pointed at the same folder
- **WHEN** each lists what it holds
- **THEN** neither lists the other's files nor reports them as broken

### Requirement: ModelTools

The extension SHALL offer the model `list_posters`, `create_poster`, `get_poster`, `update_poster` and `show_poster`, their descriptions carrying the shared poster guide. `get_poster` SHALL return the markup and stylesheet as they are now and who last changed them; `update_poster` SHALL require the revision it starts from.

#### Scenario: AnUpdateFromAnOldRevisionIsRefused
- **GIVEN** a poster at revision 2, saved by the user in the editor
- **WHEN** the model updates it from revision 1
- **THEN** nothing changes, and the refusal says revision 2 was made by the user and to read it first

### Requirement: ShowPosterDrawsTheEditor

`show_poster` SHALL declare the editor as its MCP Apps view and hand it the poster, and SHALL tell the model in text that it does not see the poster and that the user's saved touch-ups come back through `get_poster`.

#### Scenario: ThePosterIsShownInTheConversation
- **WHEN** the model calls `show_poster` in Claude Desktop
- **THEN** the editor is drawn under the tool call with the poster in it

### Requirement: ViewOnlyToolsStayFromTheModel

Saving and exporting SHALL go through tools only the view can call, and those tools SHALL not name the view's resource.

#### Scenario: TheModelIsNotOfferedSaving
- **WHEN** the model lists the extension's tools
- **THEN** saving and exporting are not among them

### Requirement: ExportsAreSavedAndOffered

Exporting from the editor SHALL write the Word or PowerPoint file in the posters folder and offer it as a download through the host, its file name as the poster's, with spaces kept; when the host cannot download, the editor SHALL say where the file was saved.

#### Scenario: AWordExportIsDownloaded
- **WHEN** the reader exports to Word in Claude Desktop
- **THEN** the file is saved in the folder and downloaded under the poster's name, spaces intact

### Requirement: AChangedEditorIsANewView

The view's resource SHALL be named after its content, so a reinstalled extension whose editor changed is never drawn with the host's cached copy of the old one.

#### Scenario: AReinstalledEditorIsTheNewOne
- **WHEN** the extension is reinstalled with a changed editor
- **THEN** its view resource has a new name

### Requirement: APosterIsRenamed

`update_poster` SHALL accept an optional new title. Given one, the poster SHALL be retitled and its file renamed after it, numbered when another file already has that name, never overwriting one; the poster's id, its revisions and the exports already made SHALL keep theirs.

#### Scenario: ThePosterFileFollowsItsNewTitle
- **GIVEN** a poster in "How many - How much.poster.html"
- **WHEN** the model updates it with the title "Menu du jour"
- **THEN** the folder holds "Menu du jour.poster.html" with the new revision and no longer the old file, and `get_poster` with the same id reads it

#### Scenario: ARenameNeverOverwrites
- **GIVEN** a file "Menu du jour.poster.html" already in the folder
- **WHEN** another poster is retitled "Menu du jour"
- **THEN** its file becomes "Menu du jour (2).poster.html" and the first file is unchanged

### Requirement: TheModelCanLookAtThePictures

`get_poster` SHALL accept a request to see the pictures. Given it, the answer SHALL also hold each photo or drawing the user put in, up to eight, as an image the model can look at, announced by its marker; a picture of another form SHALL be named instead. Without the request, no picture SHALL be sent.

#### Scenario: TheModelSeesWhatAFrameHolds
- **GIVEN** a poster whose frame named "bread" holds a picture of a family
- **WHEN** the model reads it asking to see the pictures
- **THEN** the answer holds that picture as an image after "poster-picture:1", so the model can tell it is not bread

#### Scenario: PicturesAreNotSentUnasked
- **WHEN** the model reads a poster with pictures without asking to see them
- **THEN** the answer holds markers and no image
