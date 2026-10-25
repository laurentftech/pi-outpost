## Purpose

The Claude Desktop extension "Posters (pi-outpost)": posters kept in a folder the person picks, composed by Claude through tools and retouched by the person in an editor drawn in the conversation.

## ADDED Requirements

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
