## ADDED Requirements

### Requirement: NativeOfficeFilesRenderAndEditInTheWorkspace
The native pi-outpost web app SHALL render DOCX pages and PPTX slides in its file viewer using the shared Office rendering/session integration, and SHALL offer embedded ONLYOFFICE editing for authorized writable files. Existing workspace files SHALL be supported. The native adapter SHALL enforce project and writable-root boundaries on the server, coordinate agent writes with shared revision/session guards, preserve external edits and publish saves consistently to the original workspace path. Rendering SHALL remain distinct from text extraction, and unavailable rendering SHALL be explicit.

#### Scenario: WordOpensAsRenderedPages
- **WHEN** a DOCX is opened from the file tree or a conversation file link
- **THEN** the native viewer displays its rendered pages, images and layout with page navigation, zoom and enlargement, rather than extracted text

#### Scenario: PowerPointOpensAsRenderedSlides
- **WHEN** a PPTX is opened from the file tree or a conversation file link
- **THEN** the native viewer displays actual slides with slide navigation, zoom and enlargement

#### Scenario: PreviewDoesNotLockTheDocument
- **WHEN** an authorized user opens a document in view-only mode
- **THEN** the rendered preview has no mutation capability and no human editing lock is acquired

#### Scenario: NativeEditingUsesTheSharedSession
- **WHEN** the user selects Modify for a writable workspace document
- **THEN** the shared ONLYOFFICE session opens in the native interface and the shared revision and editing exclusions apply

#### Scenario: ReadOnlyCannotSave
- **WHEN** the document is outside the writable zone or permission is revoked during editing
- **THEN** the UI prevents editing as appropriate and the server refuses publication even if a save request is forged

#### Scenario: SaveUpdatesTheWorkspaceAndAgentRead
- **WHEN** a native human edit is saved and confirmed
- **THEN** the authoritative revision and original workspace path hold the same saved Office bytes before success is shown, and the native agent reads those bytes

#### Scenario: AnExternalEditIsNotOverwritten
- **WHEN** the workspace file changes outside the service after an editing session starts
- **THEN** publication detects the changed hash, preserves both versions and reports a conflict without replacing the external edit

#### Scenario: WorkspaceAccessCannotEscapeTheProject
- **WHEN** registration or save names a path traversal, an escaping symlink or another project file
- **THEN** access is refused at the server and no out-of-scope file is read or written

#### Scenario: ProjectSwitchDoesNotLeakTheOldDocument
- **WHEN** the user switches projects or files while a view loads or a save completes
- **THEN** the new view contains only its own document and late results cannot save to the new project or display the old content there

#### Scenario: UnavailableRenderingIsExplicit
- **WHEN** ONLYOFFICE is unconfigured or unreachable
- **THEN** the viewer reports that faithful preview is unavailable and offers retry or permitted download/native-open without pretending extracted text is rendered Office content

#### Scenario: InterruptedWorkspacePublicationRecovers
- **WHEN** the process stops between revision persistence and workspace publication
- **THEN** restart recovers a consistent revision and workspace file or exposes a protected recoverable conflict, without falsely reporting saved

