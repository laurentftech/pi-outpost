# structured-exchange-conformity-report Specification

## Purpose
Lets a reviewer check a whole specification — exported from a requirements tool outside this application —
against a project's profile and rules in one run, requirement by requirement, and read the result as the
specification itself with a conformity verdict beside every requirement.

## Requirements

### Requirement: ASpecificationIsValidatedRequirementByRequirement

The reference validation interface SHALL validate a batch: a JSON Lines input, each line either a
structured-exchange document or a heading. A document line MAY name the identifiers of its subject items; its
other items are the linked objects the document carries so that rules can be checked, and SHALL NOT be
reported on as requirements. A document line naming no subjects SHALL treat every item as a subject. A heading
line SHALL name a heading and its depth.

The batch SHALL be checked against a project registry given to the interface — its profiles and their rules —
exactly as the agent's tools check one document, and in one process whatever the number of lines. A line that
is not a document satisfying the core contract, or that is held to no registered profile, SHALL be reported as
unreadable at its line number without stopping the batch.

The input's order SHALL be the report's order.

#### Scenario: EachRequirementIsCheckedWithItsNeighbours
- **WHEN** a batch line holds one subject requirement, its relations, and the requirements they link to with the attributes the rules use
- **THEN** the subject's item rules and the rules of its relations are checked, and the linked requirements are not reported on

#### Scenario: AnUnreadableLineDoesNotStopTheBatch
- **WHEN** the third line of a batch is not valid JSON
- **THEN** every other line is checked, and the report names line 3 as unreadable

#### Scenario: ALargeBatchRunsInOneProcess
- **WHEN** a batch of ten thousand document lines is validated
- **THEN** it is validated by one invocation of the interface and produces one report

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

### Requirement: TheReportIsReadableAsMarkdown

The interface SHALL write the conformity report as Markdown, using the table's Markdown export, whatever the
size of the batch.

The process status of batch validation SHALL be zero when no requirement is non-conforming and no line is
unreadable, the status for a non-conforming document when any is, and the existing distinct statuses when the
batch input cannot be read or the registry is unusable.

#### Scenario: AReviewerReadsTheReportAsMarkdown
- **WHEN** a batch is validated with a Markdown report requested
- **THEN** the Markdown holds the summary, then each chapter as a heading followed by a table of its requirements with their conformity and violations

#### Scenario: FindingsToCheckDoNotFailTheRun
- **WHEN** a batch holds only conforming requirements and requirements to check
- **THEN** the interface exits with status zero

#### Scenario: ANonConformingRequirementFailsTheRun
- **WHEN** any requirement of a batch is non-conforming
- **THEN** the interface exits with the status for a non-conforming document
