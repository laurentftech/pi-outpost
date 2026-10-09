## MODIFIED Requirements

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
