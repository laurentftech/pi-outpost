## MODIFIED Requirements

### Requirement: ARefusalPointsToTheRightPage

A refusal from showing a structure SHALL name the guide topic that covers the rule it broke: a
proposal rule SHALL point to the proposals page, a timeline rule to the timelines page, a version 2
enrichment rule to the enriched contract page, and any other rule to the graphs and tables page. A table
that tries to be a proposal SHALL point to the graphs and tables page, which shows how a table marks what
a change did to its rows, since a table cannot be proposed. A document whose `kind` or `schema` is
inside `data` SHALL be pointed to the page for the kind and version written there.

#### Scenario: AProposalRefusalPointsToProposals
- **WHEN** a document declaring a change without a target is shown
- **THEN** the refusal names the proposals topic and how to read it

#### Scenario: ATableProposalPointsToRowRoles
- **WHEN** a table naming a target is shown
- **THEN** the refusal names the graphs and tables topic, not the proposals topic

#### Scenario: ATimelineRefusalPointsToTimelines
- **WHEN** a timeline whose activity ends before it starts is shown
- **THEN** the refusal names the timelines topic

#### Scenario: AMisplacedEnvelopePointsToWhatTheDocumentMeant
- **WHEN** a timeline with `kind` (and possibly `schema`) inside `data`, a version 2 graph and a
  version 1 graph with both inside `data` are shown
- **THEN** each is refused, leading with `envelope-inside-data`, and the refusal names the timelines,
  enriched and graphs and tables topics respectively
