## ADDED Requirements

### Requirement: AMisplacedEnvelopeIsNamed

When `schema` or `kind` is inside `data` and not beside it, the refusal SHALL lead with one
`envelope-inside-data` diagnostic per such field, at its path inside `data`, saying it belongs beside
`data`. It SHALL only add to a refusal, never remove or rephrase another diagnostic nor change a
verdict. A field present in both places is not misplaced. Every user of the full gate SHALL give it.

#### Scenario: AMisplacedEnvelopeLeadsTheRefusal
- **WHEN** a graph or a timeline is validated with `schema` and `kind` inside `data`, or a timeline
  with only `kind` inside `data`
- **THEN** it is refused, the first diagnostics are `envelope-inside-data` at `/data/schema` and
  `/data/kind` (or `/data/kind` alone), once each, and the schema's other diagnostics, including the
  top level's missing properties and the other forms' requirements, follow unchanged

#### Scenario: AFieldInBothPlacesIsNotMisplaced
- **WHEN** a valid timeline also carries `kind` inside `data`
- **THEN** it is refused only because `data` does not define `kind`, with no `envelope-inside-data`

#### Scenario: NoVerdictMoves
- **WHEN** every conformance case is validated
- **THEN** each reaches the verdict the suite records, and no valid case is reported as misplaced

#### Scenario: TheAgentReadsTheMisplacedEnvelopeFirst
- **WHEN** the agent presents a graph whose `schema` and `kind` are inside `data`
- **THEN** nothing is presented, and the refusal it reads lists the two `envelope-inside-data`
  diagnostics before any other

#### Scenario: TheReferenceValidatorNamesTheMisplacedEnvelope
- **WHEN** the reference validator, as it ships, is given a graph whose `schema` and `kind` are inside
  `data`
- **THEN** it exits with the non-conforming status, and its diagnostics begin with the two
  `envelope-inside-data` diagnostics
