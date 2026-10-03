# Spec Delta

## MODIFIED Requirements

### Requirement: OnlySomeKindsMayBeProposed

Under versions 1 and 2 of the contract, the supported kinds SHALL be a graph, a sequence, and a table.
A graph SHALL declare elements and directed relationships between them; a sequence SHALL declare
participants and ordered messages between them; a table SHALL declare columns and rows aligned to those
columns. Version 3 SHALL support the same kinds and add a timeline, whose shape and rules are specified
by the `structured-exchange-timeline` capability.

A graph and a sequence SHALL be permitted to name a target and declare removals. A table SHALL NOT:
it is a projection over something else, and cannot be applied. An envelope declaring a table with a
target or a removal SHALL be rejected. A timeline SHALL NOT either, under any version that defines it.

A table SHALL nevertheless be permitted to report, per row, the role that row plays in a change it
projects. Reporting a role SHALL NOT make the table a proposal: no approval, application or handover
path SHALL treat a table as something that can be applied, whatever roles its rows declare.

#### Scenario: TableCarryingATargetIsRejected
- **WHEN** an envelope declares a table together with a target or a removal
- **THEN** it is rejected and no specialized presentation is produced

#### Scenario: TableIsStillRenderedAndReadable
- **WHEN** an envelope declares a table with no target
- **THEN** it is rendered with its declared columns and rows

#### Scenario: TableReportsRolesWithoutBecomingAProposal
- **WHEN** an envelope declares a table whose rows carry roles, and no target
- **THEN** it is accepted, and it is not offered for approval or application

#### Scenario: TimelineCarryingATargetIsRejected
- **WHEN** an envelope declares a timeline together with a target or a removal
- **THEN** it is rejected and no specialized presentation is produced
