## MODIFIED Requirements

### Requirement: TheConformityReportIsAStructuredExchangeTable

Batch validation SHALL produce a conformity report that is a valid version 2 structured-exchange table. Its
columns SHALL be the columns the subject documents declare, followed by `conformity` and `violations`. Each
subject requirement SHALL be one row, carrying its identifier, reference, kind and cells, in the order of the
input; each heading line SHALL be a heading row at its depth.

A row's conformity SHALL be `non-conforming` when a `refuse` rule, or the profile's vocabulary — including the
element kinds a relationship kind allows at its ends — is violated for it; otherwise `to check` when a `report`
rule is violated for it, a rule is not verifiable for it, or the kind of a declared end of one of its
relationships cannot be verified; otherwise `conforms`. Its violations SHALL list, for each, the rule's
identifier and statement, and for a link rule or an end the identifier of the other end. A violation of a link
rule between two subjects SHALL appear on the rows of both, and SHALL be counted once.

The report SHALL open with a summary chapter stating the number of requirements in each conformity state, the
number of violations of each rule counted once, the unreadable lines, the date of the run and the version of
the interface. The report SHALL record the profile and rules files it was checked against as artifacts carrying
their `sha256` digests. The report SHALL name the profile identifier `urn:structured-exchange-conformity-report:1`,
which the contract reserves, so that no project's profile holds a report, whatever its registry's default.

A report that would exceed the contract's ceilings SHALL NOT be written as a table; the interface SHALL say so,
and the Markdown report SHALL still be written.

#### Scenario: TheReportKeepsTheSpecificationsShape
- **WHEN** a batch holds a heading `1. Braking`, then two requirement lines
- **THEN** the report holds the summary chapter, then a heading row `1. Braking` and the two requirements beneath it, in that order

#### Scenario: EachRequirementCarriesItsVerdict
- **WHEN** one requirement conforms, one violates a `refuse` rule, and one has a relation whose other end is outside its document
- **THEN** their conformity reads `conforms`, `non-conforming` and `to check`, and the second lists the rule's identifier and statement

#### Scenario: ALinkViolationShowsOnBothRowsAndCountsOnce
- **WHEN** a relation between two subject requirements violates a rule
- **THEN** both rows list the violation, and the summary counts it once

#### Scenario: TheReportRecordsWhatItWasCheckedAgainst
- **WHEN** a report is produced
- **THEN** it carries the profile and rules files as artifacts with their digests, and its summary states the date and the interface's version

#### Scenario: TheReportIsAValidTable
- **WHEN** a report is produced for a batch within the ceilings
- **THEN** it is accepted by the core contract as a version 2 table

#### Scenario: AReportIsNeverHeldToAProjectsProfile
- **WHEN** a conformity report is presented in a project whose registry declares a default profile
- **THEN** it is presented without refusal and carries no conformance statement

#### Scenario: ARelationBetweenDisallowedKindsIsNonConforming
- **WHEN** a subject requirement has a `verifies` relation to a linked `requirement`, and the profile allows only `test` at the target of `verifies`
- **THEN** its conformity reads `non-conforming`, and its violations name the relation's other end

#### Scenario: AnEndOfUnknownKindIsToCheck
- **WHEN** a subject requirement's only finding is a `verifies` relation whose declared target is outside its document
- **THEN** its conformity reads `to check`
