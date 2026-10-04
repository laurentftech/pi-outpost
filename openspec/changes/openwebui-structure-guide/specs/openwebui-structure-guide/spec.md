## Purpose

Give Open WebUI's models the structured-exchange reference pages pi-outpost's agent reads, served by
the planning server from the same source, and point refusals at the page that would have helped.

## ADDED Requirements

### Requirement: TheGuideIsReadThroughATool

The planning server SHALL offer a tool that returns a structured-exchange reference page by topic,
as text the model reads. Without a topic it SHALL return the topics and what each is for. An unknown
topic SHALL be answered with the topics there are, not with an empty page. The tool SHALL sit behind
the same trust boundary as the other tools, and SHALL store nothing.

#### Scenario: TheIndexListsEveryTopic
- **WHEN** the guide is read without a topic
- **THEN** the answer lists every topic with what it is for

#### Scenario: ATopicReturnsItsPage
- **WHEN** the guide is read for each listed topic
- **THEN** each answer is that topic's page, as text

#### Scenario: AnUnknownTopicListsTheTopics
- **WHEN** the guide is read for a topic that does not exist
- **THEN** the answer says so and lists the topics there are

#### Scenario: ReadingTheGuideNeedsTheSecret
- **WHEN** the guide is read without the bearer key or without an identity
- **THEN** it is refused as the other tools refuse

### Requirement: OneSourceForBothHosts

The pages served SHALL be the reference pages of pi-outpost's structured-exchange skill, read from
the same files, with only the passages marked as specific to pi-outpost left out. No page served SHALL
name a tool Open WebUI's models do not have. The examples in the pages SHALL remain valid documents.

#### Scenario: AServedPageIsTheSourceWithoutPiOnlyPassages
- **WHEN** a topic's page is served
- **THEN** it equals the source file with the marked passages removed and nothing else changed

#### Scenario: NoServedPageNamesAPiOnlyTool
- **WHEN** every page is served
- **THEN** none names `write_structure_figure`, `write_structure_table`, `compare_timelines`,
  `present_structure` or `present_project_model`

#### Scenario: PiOutpostStillReadsTheWholePage
- **WHEN** pi-outpost's skill reference page holding a marked passage is read as a file
- **THEN** the passage is still there, between its markers

### Requirement: ARefusalPointsToTheRightPage

A refusal from showing a structure SHALL name the guide topic that covers the rule it broke: a
proposal rule SHALL point to the proposals page, a timeline rule to the timelines page, a version 2
enrichment rule to the enriched contract page, and any other rule to the graphs and tables page.

#### Scenario: AProposalRefusalPointsToProposals
- **WHEN** a document declaring a change without a target is shown
- **THEN** the refusal names the proposals topic and how to read it

#### Scenario: ATimelineRefusalPointsToTimelines
- **WHEN** a timeline whose activity ends before it starts is shown
- **THEN** the refusal names the timelines topic

### Requirement: TheDescriptionsNameTheGuide

The descriptions of the tools that write structured documents SHALL say the guide exists, which topic
to read for which job, and to read it before writing an unfamiliar kind.

#### Scenario: ShowStructureNamesTheGuide
- **WHEN** the published description of the structure tool is read
- **THEN** it names the guide tool and its topics
