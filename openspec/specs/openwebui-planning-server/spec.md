# openwebui-planning-server Specification

## Purpose
Offer structured-exchange planning timelines inside Open WebUI: a tool server that keeps each user's
plannings, edits them through validated targeted operations, and shows them as an interactive timeline
in the conversation, with the same contract and the same verdicts as pi-outpost.

## Requirements

### Requirement: OnlyOpenWebUIIsTrusted

The server SHALL refuse every request that does not carry the configured shared secret as a bearer
token, before it reads any identity header or any stored planning. The server SHALL refuse to start
without a configured secret.

The owner of a request SHALL be the user Open WebUI forwards with the request, in one of two
configured modes:

- **Signed**: the owner SHALL be the subject of the token Open WebUI signs with the configured
  identity key. A token that is missing, whose signature does not verify, whose issuer is not Open
  WebUI, or that has expired, SHALL be refused. Plain user headers SHALL be ignored in this mode.
- **Plain**: the owner SHALL be the user identifier header Open WebUI forwards.

A request carrying the secret but no acceptable identity SHALL be refused and SHALL NOT fall back to
any default or shared owner. The server SHALL refuse to start in signed mode without an identity key.

#### Scenario: ARequestWithoutTheSecretIsRefused
- **WHEN** a request names a user and a planning but carries no bearer token, or a wrong one
- **THEN** it is refused as unauthorised, and nothing about that user or planning is returned or changed

#### Scenario: ARequestWithoutAUserIsRefused
- **WHEN** a request carries the right secret but no forwarded user identifier
- **THEN** it is refused, and no planning is listed, read or written

#### Scenario: AForgedTokenIsRefused
- **WHEN** in signed mode, a request carries the right secret and a token signed with another key
- **THEN** it is refused, and no planning is listed, read or written

#### Scenario: AnExpiredTokenIsRefused
- **WHEN** in signed mode, a request carries the right secret and a correctly signed token past its
  expiry
- **THEN** it is refused, and no planning is listed, read or written

#### Scenario: PlainHeadersAreIgnoredInSignedMode
- **WHEN** in signed mode, a request carries a valid token for one user and a plain user identifier
  header naming another
- **THEN** it acts for the token's user only

#### Scenario: TheServerWillNotStartWithoutASecret
- **WHEN** the server is started with no secret configured
- **THEN** it exits with an error naming the missing setting, and listens on nothing

#### Scenario: SignedModeWillNotStartWithoutAKey
- **WHEN** the server is started in signed mode with no identity key configured
- **THEN** it exits with an error naming the missing setting, and listens on nothing

### Requirement: PlanningsArePersonal

A planning SHALL belong to the user who created it. A user SHALL list, read, change and show only
their own plannings. A planning identifier that belongs to another user SHALL be answered exactly as
an identifier that does not exist, so that its existence is not disclosed.

#### Scenario: AUserListsOnlyTheirOwnPlannings
- **WHEN** two users have each created a planning and one of them lists their plannings
- **THEN** only their own planning is listed

#### Scenario: AnotherUsersPlanningIsNotFound
- **WHEN** a user reads, updates or shows a planning another user created
- **THEN** the answer is the same not-found answer an unknown identifier receives, and the planning is
  unchanged

### Requirement: APlanningIsAVersionThreeTimeline

A planning SHALL be a structured-exchange version 3 document of kind `timeline`. Creation SHALL apply
the same schema, semantic rules and limits pi-outpost applies, and SHALL refuse what pi-outpost
refuses, with the same diagnostics, save for the envelope. A stored planning SHALL be readable by
pi-outpost as it is.

The envelope SHALL be judged before the contract. When `schema` or `kind` is missing beside `data`
and present inside it, the answer SHALL name each as belonging beside `data`, at its path inside
`data`, with the form to write, followed by the diagnostics pi-outpost reports for the same document
with them in place. When `kind` is not `timeline` or `schema` is not version 3, missing or wrong, the
answer SHALL name that field and the form to write, and SHALL NOT carry the diagnostics of the other
forms `data` can take. A wrong envelope SHALL always be refused.

A planning SHALL be a plan, not a comparison: a document that declares what it is compared to, a
previous position, or a change role SHALL be refused, since comparisons are drawn when showing.

#### Scenario: AValidTimelineIsCreated
- **WHEN** a user creates a planning from a valid version 3 timeline
- **THEN** it is stored, and the answer carries its identifier, its first revision and its title

#### Scenario: AnInvalidTimelineIsRefusedWithDiagnostics
- **WHEN** a user creates a planning from a timeline with an inverted activity
- **THEN** nothing is stored, and the answer lists the same diagnostic pi-outpost reports for that
  document

#### Scenario: AnotherKindIsRefused
- **WHEN** a user creates a planning from a valid version 3 document whose kind is not `timeline`
- **THEN** it is refused, and nothing is stored

#### Scenario: AMisplacedEnvelopeIsNamedWithTheRest
- **WHEN** a user creates a planning whose `schema` and `kind` are inside `data`, and one of whose
  activities has no end
- **THEN** nothing is stored, the answer first names `/data/schema` and `/data/kind` as belonging
  beside `data` with the form to write, then lists exactly what pi-outpost reports for the same
  planning with its envelope in place, and no diagnostic speaks of nodes, edges, participants,
  messages or columns

#### Scenario: AMisplacedEnvelopeIsRefusedEvenWhenTheRestIsValid
- **WHEN** a user creates a planning that is valid once `schema` and `kind` are moved out of `data`
- **THEN** it is refused, the answer names only the two misplaced fields, and nothing is stored

#### Scenario: AWrongEnvelopeIsAnsweredWithTheEnvelopeAlone
- **WHEN** a user creates a planning whose `kind` or `schema` is missing, or names another kind or
  version, at the top or inside `data`
- **THEN** it is refused, the answer names each wrong field at the path it was found with the form to
  write, carries no diagnostic of the other forms `data` can take, and nothing is stored

#### Scenario: AComparisonIsNotAPlanning
- **WHEN** a user creates a planning from a valid compared timeline
- **THEN** it is refused, the answer says comparisons are drawn when showing, and nothing is stored

#### Scenario: AStoredPlanningOpensInPiOutpost
- **WHEN** a stored planning's current document is validated by pi-outpost's structured-exchange check
- **THEN** it is valid and means the same planning

### Requirement: EveryWriteIsARevision

Every accepted creation or update SHALL produce a new numbered revision; earlier revisions SHALL be
kept unchanged and SHALL remain readable. Reading a planning SHALL return its current document and
revision number; a user MAY read a named earlier revision.

#### Scenario: AnUpdateKeepsThePreviousRevision
- **WHEN** a planning at revision 1 is updated
- **THEN** it is at revision 2, and revision 1 still reads as it was before the update

#### Scenario: AnUnknownRevisionIsNotFound
- **WHEN** a user reads a revision number the planning never had
- **THEN** the answer is not found, and names the current revision

### Requirement: UpdatesAreTargetedAndValidated

An update SHALL be a list of operations naming what they change by identifier: add, change, move or
remove a task; add, change or remove an item of a task; add or remove a separator; add or remove a
dependency; change the title, the time range, the periods or the references. The operations of one update SHALL apply together or
not at all. The result SHALL be validated as a creation is; a refused update SHALL change nothing and
SHALL return the diagnostics, including which operation could not apply.

So that every item can be named, creation SHALL give each item declared without an identifier one,
unique within the planning, and SHALL return the stored document with them.

An update SHALL name the revision it was prepared against. An update against a revision that is no
longer current SHALL be refused, and SHALL name the current revision, so a change is never applied to a
planning its author has not seen.

#### Scenario: MovingOneMilestoneChangesOnlyThatMilestone
- **WHEN** an update changes the date of one milestone, named by its identifier
- **THEN** the new revision differs from the previous one in that date only

#### Scenario: ItemsWithoutIdentifiersCanBeNamedAfterCreation
- **WHEN** a planning is created with a milestone declared without an identifier
- **THEN** the stored document gives that milestone an identifier, and an update naming it applies

#### Scenario: AnOperationOnAMissingIdentifierRefusesTheWholeUpdate
- **WHEN** an update holds a valid operation followed by one naming a task that does not exist
- **THEN** the planning is unchanged, no revision is added, and the answer names the failing operation

#### Scenario: AnUpdateThatBreaksTheContractIsRefused
- **WHEN** an update moves an activity's end before its start
- **THEN** the planning is unchanged, and the answer carries the contract's diagnostic

#### Scenario: AStaleUpdateIsRefused
- **WHEN** an update names revision 1 while the planning is at revision 2
- **THEN** the planning is unchanged, and the answer names revision 2 as current

### Requirement: APlanningIsShownInTheConversation

Showing a planning SHALL return the timeline in the form Open WebUI embeds in the conversation as rich
UI, drawn by the same viewer pi-outpost uses, with the same scales and the same details on demand.
Showing MAY name an earlier revision to compare against; the timeline SHALL then present what moved as
pi-outpost's comparison does. The answer SHALL carry the planning in the HTML itself and SHALL NOT
require the user's browser to reach the server. Open WebUI does not pass an embedded answer on to the
model, so the model SHALL learn a planning's content by reading it, not by showing it.

The embedded timeline SHALL work inside Open WebUI's default frame sandbox, without same-origin access,
and SHALL report its own height to the conversation.

#### Scenario: ShowingAPlanningEmbedsTheTimeline
- **WHEN** a user shows one of their plannings
- **THEN** the answer is inline HTML marked for embedding, and opening it draws every task, activity and
  milestone of the current revision

#### Scenario: ShowingAComparisonDrawsWhatMoved
- **WHEN** a user shows a planning compared to revision 1, after a milestone was moved
- **THEN** the timeline shows the milestone's previous and current positions and the shift between them

#### Scenario: TheEmbedRunsInTheDefaultSandbox
- **WHEN** the embedded timeline is opened in a frame that allows scripts but not same-origin access
- **THEN** it draws, changes scale, opens an item's details, and reports its height to its parent

### Requirement: AClickProposesAPromptButNeverSendsIt

A click on a task or a milestone in the embedded timeline SHALL ask Open WebUI to fill the chat input
with a prompt naming that task or milestone and its planning. The embedded timeline SHALL NOT ask Open
WebUI to submit a prompt.

#### Scenario: ClickingAMilestoneFillsTheInput
- **WHEN** a user clicks a milestone in the embedded timeline
- **THEN** the parent is asked to fill the chat input with a prompt naming the milestone and the
  planning, and is never asked to submit it

### Requirement: ToolsAreDescribedForOpenWebUI

The server SHALL publish an OpenAPI description from which Open WebUI builds one tool per operation:
list, create, get, update and show. Each tool description SHALL carry what a model needs to use it
correctly without other documentation, including a complete minimal timeline for creation and a
complete update example.

#### Scenario: TheDescriptionNamesTheFiveTools
- **WHEN** the OpenAPI description is fetched
- **THEN** it declares exactly the five planning operations, each with a description and an input
  schema

#### Scenario: TheCreationExampleIsValid
- **WHEN** the timeline example in the creation tool's description is created as a planning
- **THEN** it is accepted

#### Scenario: TheUpdateExampleApplies
- **WHEN** the update example in the update tool's description is applied to the planning created from
  the creation example
- **THEN** it is accepted

### Requirement: StorageIsBounded

The server SHALL enforce configured ceilings on a planning's size, on the number of revisions kept per
planning, and on the number of plannings per user. A request that would exceed one SHALL be refused,
SHALL change nothing, and SHALL name the ceiling.

#### Scenario: APlanningTooLargeIsRefused
- **WHEN** a user creates a planning larger than the configured size ceiling
- **THEN** it is refused, nothing is stored, and the answer names the ceiling

#### Scenario: TheOldestRevisionsAreNotSilentlyLost
- **WHEN** an update would take a planning past the revision ceiling
- **THEN** the update is refused with the ceiling named, and every kept revision is unchanged

### Requirement: TheServerShipsAsAContainerImage

Each release SHALL publish a container image of the server, versioned like the release, that runs
from environment settings alone and keeps every planning under one data directory meant to be a
mounted volume. The image SHALL apply the same refusals to start as the server. A prerelease SHALL NOT
move the image's `latest` tag. The repository SHALL carry the file the image is built from, so that
a deployment may rebuild it internally.

#### Scenario: TheImageServesFromItsEnvironment
- **WHEN** the image is run with a secret, an identity key and a data volume, and a planning is
  created through it
- **THEN** it answers the OpenAPI description, and the planning's revision file is in the volume

#### Scenario: TheImageRefusesToStartWithoutASecret
- **WHEN** the image is run without a secret
- **THEN** the container exits with an error naming the missing setting

#### Scenario: APlanningOutlivesTheContainer
- **WHEN** a planning is created, the container is replaced by a new one on the same volume, and the
  planning is read
- **THEN** it is read as it was stored

#### Scenario: APrereleaseDoesNotMoveLatest
- **WHEN** the release version is a prerelease
- **THEN** the image is published under that version only, and `latest` is unchanged
