## ADDED Requirements

### Requirement: ClaudeOffersSharedOfficeTools
The existing stdio extension SHALL optionally offer shared-service tools to create, list, read, update and show Word and PowerPoint documents. Reads SHALL return current revision, useful text/structure and editing status. Updates SHALL require base_revision. Model-readable summaries SHALL be available in text and, when present, structured content.

#### Scenario: ClaudeCreatesBothOfficeKinds
- **WHEN** Claude calls the create tools for a worksheet and a slide deck
- **THEN** the shared service stores a DOCX and a PPTX and Claude receives their IDs, revisions and readable status

#### Scenario: ClaudeContinuesFromHumanChanges
- **WHEN** a human edit has been confirmed and Claude reads then updates that document
- **THEN** the read contains the saved text/structure and new revision, and the update uses that revision

#### Scenario: EitherResultChannelExplainsStatus
- **WHEN** the host consumes only text or only structured content from an Office result containing both
- **THEN** either channel identifies the document, revision and any refusal or pending-save status

### Requirement: TheOfficeCardLaunchesTheSharedEditor
The Office MCP App SHALL show document name, revision, status, download and an explicit editing action. It SHALL obtain a fresh launch capability through an app-only tool after user action. Inline editing SHALL be enabled only when tested with the actual Claude host and required CSP domains; a browser flow to the same hosted page SHALL remain available. Neither flow SHALL send a chat message on behalf of the user.

#### Scenario: TheUserOpensTheEditor
- **WHEN** the user selects Modify in the Office card
- **THEN** an app-only request authorizes that document and opens the shared editor through a supported host mechanism without sending a chat message

#### Scenario: ABlockedInlineEditorHasABrowserPath
- **WHEN** the host blocks required frames, networking or storage
- **THEN** the card explains the problem and offers the external browser path without weakening host isolation

#### Scenario: AnOldCardRequestsFreshAccess
- **WHEN** a card from an old conversation is reopened
- **THEN** current authorization and status are checked and a fresh launch capability is requested on user action

#### Scenario: SaveStatusReflectsPersistence
- **WHEN** the editor is saving, saved or failed
- **THEN** the UI distinguishes these states and does not claim saved before the backend has committed

### Requirement: OfficeConfigurationDoesNotBreakPlannings
Office service configuration SHALL be optional and separate from the existing planning folder. The planning resource SHALL remain network-free. Office network permissions SHALL be limited to configured domains and SHALL NOT widen planning permissions.

#### Scenario: AnExistingInstallStillWorks
- **WHEN** the extension starts with the existing planning configuration and no Office service
- **THEN** planning tools work as before and Office attempts explain the missing configuration

#### Scenario: PlanningRemainsOffline
- **WHEN** Office support is configured and the planning resource is read
- **THEN** the planning view remains self-contained with no external domains or resource requests

#### Scenario: ThePackagedOfficeClientWorks
- **WHEN** the built MCP bundle is installed with Office configuration
- **THEN** the bundled stdio server creates and shows a document using the shared service without exposing its credential
