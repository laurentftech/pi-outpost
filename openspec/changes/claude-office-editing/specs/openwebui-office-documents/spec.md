## ADDED Requirements

### Requirement: OpenWebUIUsesTheSharedDocumentLifecycle
When shared editing is enabled, existing Open WebUI Office tool names and download cards SHALL delegate creation and updates to the common document service and SHALL expose stable IDs, current revisions and editing status through list/read results. Updates SHALL require base_revision. Existing bearer/user verification and per-owner isolation SHALL remain enforced. Download-only mode SHALL remain available without ONLYOFFICE.

#### Scenario: ExistingDownloadsRemainAvailable
- **WHEN** an authenticated user creates a Word document or presentation
- **THEN** the current tool names still return a downloadable Office file equal to the committed bytes

#### Scenario: AnUpdateNeedsTheRevisionRead
- **WHEN** an update omits base_revision or supplies an old revision
- **THEN** nothing changes and the refusal explains how to read the current revision

#### Scenario: TheCardUsesTheSameEditor
- **WHEN** the user chooses Modify in an editing-enabled Open WebUI card
- **THEN** the same hosted editor and session lifecycle used by Claude are invoked with that user authorization

#### Scenario: TheToolBoundaryStillRejectsUnsignedCalls
- **WHEN** a document tool request has no valid bearer or required user identity
- **THEN** it is refused before document lookup or mutation

#### Scenario: OnlyExplicitlyLinkedClientsShareDocuments
- **WHEN** Claude and Open WebUI use an explicitly mapped principal and one saves a document
- **THEN** the other reads the same authoritative revision; unmapped principals cannot read it

#### Scenario: DownloadOnlyDeploymentsDoNotRequireAnEditor
- **WHEN** ONLYOFFICE is not configured in a legacy download-only deployment
- **THEN** existing document creation and download still work and visual editing is unavailable with a clear setup explanation
