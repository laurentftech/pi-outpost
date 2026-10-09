## MODIFIED Requirements

### Requirement: ThePlanningToolsKeepTheirContract

The server SHALL offer list, create, get, update and show for plannings, with the same validation,
targeted operations, revision checks and diagnostics as the Open WebUI server's planning tools, from
the same shared code. A refusal SHALL change nothing and SHALL be worded for the model. Every answer
SHALL carry text the model can read.

#### Scenario: CreateThenListThenGet
- **WHEN** a valid timeline is created, then plannings are listed and the new one is read
- **THEN** it is listed with its title and revision 1, and reading it returns the document as created

#### Scenario: AnInvalidTimelineIsRefusedWithTheGatesDiagnostics
- **WHEN** a timeline with an inverted activity is created
- **THEN** nothing is written, and the diagnostics equal pi-outpost's gate's for that document

#### Scenario: AMisplacedEnvelopeIsNamedInTheAnswer
- **WHEN** a planning whose `schema` and `kind` are inside `data`, and one of whose activities has no
  end, is created
- **THEN** nothing is written, and the answer names `/data/schema` and `/data/kind` as misplaced, then
  lists pi-outpost's gate's diagnostics for the planning with its envelope in place, and nothing about
  nodes, edges, participants, messages or columns

#### Scenario: AnUpdateIsTargetedAndRevisioned
- **WHEN** an update moves one milestone against the current revision
- **THEN** the planning file differs from the previous revision in that date only, and an update
  against the previous revision is then refused, naming the current one

#### Scenario: AFileEditedByHandIsJudgedOnRead
- **WHEN** a planning file is edited outside the server into an invalid document, and the planning is
  read
- **THEN** the answer carries the gate's diagnostics, and the listing marks that planning as unreadable
  rather than hiding it
