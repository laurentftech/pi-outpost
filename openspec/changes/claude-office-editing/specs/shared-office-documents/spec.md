## ADDED Requirements

### Requirement: OneDocumentCoreServesBothHosts
The service SHALL implement Office creation, reading, targeted updates, revision storage and editor lifecycle once, using the existing office builders. Claude MCP and Open WebUI SHALL delegate to this implementation; owners SHALL be derived from authenticated adapter identities, never tool arguments.

#### Scenario: BothAdaptersUseTheSameCore
- **WHEN** equivalent Word and PowerPoint operations are invoked through both adapters
- **THEN** both call the shared implementation and enforce identical validation, revisions and editor states

#### Scenario: OwnersAreNotChosenByTheModel
- **WHEN** an operation supplies another principal or guesses another document ID
- **THEN** access is refused without disclosing that document; no data changes

#### Scenario: LibrariesAreLinkedOnlyExplicitly
- **WHEN** two host identities have the same display name
- **THEN** their libraries remain separate unless an administrator explicitly maps them to the same principal

### Requirement: OfficeBytesAreRevisioned
The service SHALL retain immutable authoritative DOCX/PPTX revisions with stable document IDs, parent revisions, checksums and provenance. Commits SHALL be atomic and recoverable. Writes SHALL require the current base revision and SHALL NOT silently replace same-name files. Persistent libraries SHALL NOT inherit automatic temporary-file eviction.

#### Scenario: ARevisionPreservesExactBytes
- **WHEN** a new Office file is committed and downloaded
- **THEN** downloaded bytes equal that committed revision and its checksum, and no Markdown or HTML conversion occurs

#### Scenario: AStaleWriteChangesNothing
- **WHEN** two agent updates use the same base revision
- **THEN** at most one commits; the other reports the current revision and leaves it unchanged

#### Scenario: ANameCollisionDoesNotOverwrite
- **WHEN** creation uses an existing file name
- **THEN** the existing document is unchanged and the answer explains explicit replacement

#### Scenario: ACrashCannotPublishAPartialRevision
- **WHEN** the process stops during persistence and restarts
- **THEN** the current pointer resolves to a complete committed revision; original revisions remain readable

#### Scenario: ExistingDocumentsMigrateWithoutLoss
- **WHEN** an existing per-user kept file is migrated
- **THEN** its exact bytes become revision 1 under the same owner, and old chat downloads remain unchanged

#### Scenario: QuotaDoesNotDeleteTeachingMaterials
- **WHEN** a persistent library reaches its quota
- **THEN** a new write is refused with the quota reason and existing documents and revisions remain

### Requirement: HumanEditingExcludesAgentWrites
The service SHALL acquire one editing session atomically against agent mutations. Agent writes SHALL be refused during editing, saving or recovery-required states. Reads SHALL identify the last committed revision and any pending human changes. Session release SHALL require confirmed persistence or explicit informed abandonment, not tab closure or a timeout.

#### Scenario: AnEditorAndAnAgentCannotBothAcquireTheDocument
- **WHEN** editor acquisition races with an agent update
- **THEN** the operations serialize; the editor captures the resulting current revision or the agent is refused

#### Scenario: AgentWritesWaitForHumanSave
- **WHEN** a document is open for human editing and the agent attempts a change
- **THEN** the write is refused with editing status; reads report that their revision excludes pending edits

#### Scenario: ClosingATabDoesNotMeanSaved
- **WHEN** the browser closes before save confirmation
- **THEN** the session remains protected until confirmed persistence or explicit recovery

#### Scenario: AFailedSaveRequiresRecovery
- **WHEN** a save times out or its callback is invalid
- **THEN** the last committed bytes remain unchanged, the UI reports the failure and agent writes remain blocked

#### Scenario: AnIntermediateSaveDoesNotReleaseTheSession
- **WHEN** ONLYOFFICE produces an intermediate force-save snapshot
- **THEN** it is handled according to the pinned lifecycle while the editing session continues to exclude agent writes

#### Scenario: TheFinalSaveReleasesOnlyAfterCommit
- **WHEN** a validated final save completes
- **THEN** the committed revision is published before the session becomes ready and the next agent read returns it

#### Scenario: AnAbandonedGenerationCannotWriteLater
- **WHEN** the user explicitly abandons pending changes and a new revision is created
- **THEN** a delayed callback from the abandoned session cannot change that revision

### Requirement: EditorAccessIsScopedAndAuthenticated
The service SHALL authorize document reads and editing for the authenticated principal. Launch capabilities SHALL be short-lived, single-use and document/session-scoped, absent from model context and permanent chat payloads. The service SHALL verify ONLYOFFICE JWT and session binding, constrain outbound file retrieval to the configured ONLYOFFICE service and validate bounded Office packages before committing. Shared credentials SHALL remain server-side.

#### Scenario: ALaunchTicketCannotBeReusedOrTransferred
- **WHEN** a launch ticket expires, is replayed or is used to request a different document
- **THEN** access is refused and no other document or session is exposed

#### Scenario: SecretsDoNotReachTheConversation
- **WHEN** a document is created and its card is shown
- **THEN** model-facing results and stored card payloads contain no service credential, JWT signing key or reusable editor ticket

#### Scenario: ACallbackMustBelongToTheSession
- **WHEN** a callback lacks valid JWT or names a different session key
- **THEN** it is refused before download or mutation

#### Scenario: ACallbackCannotFetchArbitraryURLs
- **WHEN** a validly signed callback supplies an unapproved URL or redirects to one
- **THEN** the unapproved address is never fetched and the document remains unchanged

#### Scenario: InvalidSavedPackagesAreRefused
- **WHEN** the returned bytes are oversized, malformed, over-expanded or of the wrong Office kind
- **THEN** no revision is committed and the session presents a recoverable failure

#### Scenario: DuplicateCallbacksAreIdempotent
- **WHEN** a valid final callback is delivered twice
- **THEN** only one committed revision is produced

### Requirement: FidelityLimitsAreExplicit
The service SHALL keep original packages and previous revisions and SHALL NOT use a Markdown/HTML round trip for visual editing. Layout-rebuilding agent operations SHALL identify their limits before mutation. Unsupported fidelity-preserving requests SHALL be refused or offered as a separate copy. Release SHALL document fidelity results from representative teacher fixtures in ONLYOFFICE and Microsoft Office.

#### Scenario: AVisualEditKeepsAnOfficePackage
- **WHEN** a worksheet or deck is manually edited and saved
- **THEN** the result remains an editable DOCX or PPTX and its original revision remains recoverable

#### Scenario: ALayoutRebuildingChangeIsNotCalledLossless
- **WHEN** a requested text-only change cannot be expressed by the existing tool without rebuilding the section or slide
- **THEN** the tool makes no silent reconstruction and reports the limitation or offers a separate copy

#### Scenario: RepresentativeFilesAreQualified
- **WHEN** the feature is prepared for release
- **THEN** recorded comparisons cover agreed Word and PowerPoint fixtures, matching fonts and relevant layout/content features, including any accepted differences
