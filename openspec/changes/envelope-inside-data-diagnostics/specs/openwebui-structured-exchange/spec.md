## MODIFIED Requirements

### Requirement: ARefusalCarriesTheContractDiagnostics

A document the gate refuses SHALL NOT be embedded. The answer SHALL carry the same diagnostics
pi-outpost reports for that document, so the model can correct it and show it again.

#### Scenario: ADanglingRelationshipIsRefused
- **WHEN** a graph whose relationship names an element that does not exist is shown
- **THEN** nothing is embedded, and the answer's diagnostics equal those pi-outpost's gate gives for
  the same document

#### Scenario: AChangeWithoutATargetIsRefused
- **WHEN** a document declares a change to an element but names no target
- **THEN** it is refused with the contract's diagnostic, and nothing is embedded

#### Scenario: ADocumentTooLargeIsRefused
- **WHEN** a document larger than the contract's ceiling is shown
- **THEN** it is refused, the ceiling is named, and nothing is embedded

#### Scenario: AMisplacedEnvelopeIsNamedFirstByShowStructure
- **WHEN** a graph whose `schema` and `kind` are inside `data` is shown
- **THEN** nothing is embedded, the answer's diagnostics equal those pi-outpost's gate gives for the
  same document, and the first two are `envelope-inside-data` at `/data/schema` and `/data/kind`
