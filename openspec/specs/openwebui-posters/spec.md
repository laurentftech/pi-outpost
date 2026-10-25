# openwebui-posters Specification

## Purpose
Posters on the Open WebUI tool server: the model composes and changes them through tools, and the person retouches and exports them in an embed — with touch-ups that, for now, stay in her browser.

## Requirements

### Requirement: PosterTools

The tool server SHALL offer the model tools to list, create, read, change and show posters, kept per user as the plannings are, their descriptions carrying the shared poster guide, a change requiring the revision it starts from.

#### Scenario: EachUserSeesTheirOwnPosters
- **GIVEN** posters created by two users
- **WHEN** each lists their posters
- **THEN** each sees only their own

### Requirement: ShowPosterEmbedsTheEditor

Showing a poster SHALL return a self-contained page Open WebUI embeds in the conversation, carrying the editor and the poster, that makes no request of its own and survives Open WebUI's storage of embeds.

#### Scenario: TheEditorAppearsInTheChat
- **WHEN** the model shows a poster
- **THEN** the editor is drawn in the conversation with the poster in it

### Requirement: EmbedWithoutSameOriginIsReadOnly

When Open WebUI does not allow its frames the same origin, the embed SHALL show the poster read-only with its exports, and SHALL say that editing needs that setting.

#### Scenario: TheDefaultSandboxStillShowsThePoster
- **GIVEN** Open WebUI with same-origin frames not allowed
- **WHEN** the model shows a poster
- **THEN** the poster is drawn, Word and PowerPoint export work, and the embed says editing needs the setting

### Requirement: ExportsWorkInTheEmbed

The embed SHALL export the poster to Word and PowerPoint and download the file in the browser, without reaching the tool server.

#### Scenario: AWordFileFromTheEmbed
- **WHEN** the person exports to Word in the embed
- **THEN** the browser downloads the `.docx`, and no request goes to the tool server

### Requirement: TouchUpsStayInTheBrowserWhenSavingIsNotConfigured

When browser saving is not configured, touch-ups made in the embed SHALL remain in the browser, and the embed SHALL say so: its exports carry them, but the model's next change starts from the last version the model wrote.

#### Scenario: TheLimitIsSaid
- **GIVEN** browser saving is not configured
- **WHEN** the person retouches a poster in the embed
- **THEN** the embed says the changes are kept in its exports only, and the model does not see them

#### Scenario: TheModelStartsFromItsOwnVersion
- **GIVEN** browser saving is not configured and a poster is retouched in the embed
- **WHEN** the model reads the poster
- **THEN** it reads the version it last wrote

### Requirement: EmbedSavesTouchUpsAsAnOwnerScopedRevision
The embed SHALL save edited poster content as a new revision of that poster for its original owner, using a narrowly scoped capability instead of the tool server bearer secret.

#### Scenario: AUserSavesTouchUps
- **GIVEN** a poster embed opened at revision 2 with edits and a valid save capability
- **WHEN** the user saves the poster
- **THEN** the server stores the edits as revision 3 for that poster's owner and returns revision 3

#### Scenario: AStaleEmbedCannotOverwriteANewerRevision
- **GIVEN** an embed opened at revision 2 and the server has since advanced the poster to revision 3
- **WHEN** the old embed tries to save
- **THEN** the save is refused as a conflict and revision 3 remains unchanged

#### Scenario: TheEmbedDoesNotReceiveTheToolBearerSecret
- **WHEN** the server renders a poster embed
- **THEN** the page contains only a capability limited to saving that poster from its stated revision, and never contains the Open WebUI tool bearer secret

### Requirement: TheModelReadsTheLatestSavedTouchUps
After a successful embed save, the poster's ordinary read and show tools SHALL return the latest saved revision so the model can continue from the user's edits.

#### Scenario: TheModelStartsFromTheSavedTouchUps
- **GIVEN** the user saved a poster embed as revision 3
- **WHEN** the model calls `get_poster` without naming a revision
- **THEN** it receives revision 3 and the user's saved markup and stylesheet

### Requirement: PosterSaveEndpointIsConstrainedToTheConfiguredWebUI
The browser save endpoint SHALL accept writes only from the configured Open WebUI origin and SHALL reject missing or invalid scoped capabilities.

#### Scenario: ADifferentOriginCannotSave
- **GIVEN** the save endpoint is configured for one Open WebUI origin
- **WHEN** a save request comes from another origin
- **THEN** the server refuses it without changing poster data

#### Scenario: AMissingOrInvalidCapabilityCannotSave
- **WHEN** a request has no valid scoped capability
- **THEN** the server refuses it without changing poster data

### Requirement: APosterIsRetitled

`update_poster` SHALL accept an optional new title, which becomes the poster's title in `list_posters`, `get_poster` and the names of its downloads.

#### Scenario: TheNewTitleIsListed
- **WHEN** the model updates a poster with the title "Menu du jour"
- **THEN** `list_posters` and `get_poster` give "Menu du jour" for that poster id

### Requirement: TheModelCanLookAtThePicturesInOpenWebUI

`get_poster` SHALL accept a request to see the pictures. Given it, the answer SHALL also list each photo or drawing the user put in, up to eight, with its marker and the picture as a whole base64 data URL, the form Open WebUI hands a model as an image in native function calling. Without the request, no picture SHALL be sent.

#### Scenario: TheModelSeesWhatAFrameHoldsInOpenWebUI
- **GIVEN** a poster whose frame holds a photo the user put in
- **WHEN** the model reads it asking to see the pictures
- **THEN** the answer lists that photo with its marker, as a whole base64 data URL, and the markup still holds markers only

#### Scenario: PicturesAreNotSentUnaskedInOpenWebUI
- **WHEN** the model reads the poster without asking to see the pictures
- **THEN** the answer holds no picture
