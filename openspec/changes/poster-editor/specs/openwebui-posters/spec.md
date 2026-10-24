## Purpose

Posters on the Open WebUI tool server: the model composes and changes them through tools, and the person retouches and exports them in an embed — with touch-ups that, for now, stay in her browser.

## ADDED Requirements

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

### Requirement: TouchUpsStayInTheBrowser

Touch-ups made in the embed SHALL NOT be sent to the tool server, and the embed SHALL say so: its exports carry them, but the model's next change starts from the last version the model wrote.

#### Scenario: TheLimitIsSaid
- **WHEN** the person retouches a poster in the embed
- **THEN** the embed says the changes are kept in its exports only, and the model does not see them

#### Scenario: TheModelStartsFromItsOwnVersion
- **GIVEN** a poster retouched in the embed
- **WHEN** the model reads the poster
- **THEN** it reads the version it last wrote
