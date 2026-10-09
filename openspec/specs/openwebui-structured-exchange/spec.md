# openwebui-structured-exchange Specification

## Purpose
Show any structured-exchange document in an Open WebUI chat — graphs, sequences, tables, timelines and
proposals — validated with exactly pi-outpost's gate and drawn with pi-outpost's rendering, without
storing anything.

## Requirements

### Requirement: AnyStructuredExchangeDocumentCanBeShown

The planning server SHALL offer a tool that takes a structured-exchange document of any supported
version and kind, judges it with the same schema, semantic rules and limits pi-outpost's presentation
tool applies, and, when it is valid, returns it in the form Open WebUI embeds in the conversation as
rich UI. The document SHALL be drawn by the same rendering pi-outpost uses for that kind. The tool
SHALL accept the document as a JSON object, or as a string holding one.

#### Scenario: AGraphIsShown
- **WHEN** a valid version 2 graph is shown
- **THEN** the answer is inline HTML marked for embedding, and opening it draws every element and
  every relationship of the graph

#### Scenario: EveryKindIsShown
- **WHEN** a valid sequence, a valid table and a valid timeline are each shown
- **THEN** each answer embeds the document, and opening it draws that kind's rendering: every
  participant and message, every row, every task and item

#### Scenario: AnEarlierVersionIsShown
- **WHEN** a valid version 1 document is shown
- **THEN** it is accepted and drawn as pi-outpost draws it

#### Scenario: ADocumentGivenAsAStringIsShown
- **WHEN** a valid document is passed as a string holding its JSON
- **THEN** it is shown exactly as the same document passed as an object

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

### Requirement: TheDocumentIsShownAsValidated

The embedded document SHALL be structurally identical to the document that was validated: no field,
order or value added, dropped, reordered, coerced or truncated. The reader SHALL be able to see the
document as written, beside its rendering.

#### Scenario: TheEmbeddedDocumentEqualsTheOneValidated
- **WHEN** a valid proposal is shown
- **THEN** the document carried by the embed is deep-equal to the document that was sent, fields in
  the same order

### Requirement: AProposalShowsWhatItWouldChangeAndOffersNoApply

A proposal SHALL be drawn as what it would change, with additions, changed elements and declared
removals distinguishable from one another, and every element it carries shown. The embedded page SHALL
offer no action that applies the proposal, and SHALL NOT ask Open WebUI to send a message.

#### Scenario: AdditionsChangesAndRemovalsAreDistinguishable
- **WHEN** a proposal holding an addition, a change and a removal is shown
- **THEN** the drawing marks each of the three differently, shows every element of the proposal, and
  holds no control that applies it

### Requirement: TheReaderTakesFiguresAndTablesAway

Inside Open WebUI's sandboxed frame, the reader SHALL be able to use the exports pi-outpost's rendering
offers for the kind shown: a diagram as an SVG figure, and a table as Markdown, CSV or XLSX. They
SHALL be pi-outpost's own exports: the figure is the drawing as shown, saved as a standalone SVG, and
a table's text is the shared table export.

#### Scenario: AFigureIsDownloadedFromTheEmbed
- **WHEN** the reader asks for the SVG figure of a shown graph, in a frame that allows scripts and
  downloads but not same-origin access
- **THEN** a download starts, and its content is a standalone SVG drawing every element of the graph

#### Scenario: ATableIsDownloadedFromTheEmbed
- **WHEN** the reader asks for the Markdown of a shown table, in the same frame
- **THEN** a download starts, and its content is pi-outpost's Markdown export of that table

### Requirement: ShowingStoresNothingAndKeepsTheTrustBoundary

Showing a document SHALL store nothing on the server. It SHALL sit behind the same trust boundary as
the planning tools: refused without the connection's bearer key, and refused without an acceptable
user identity.

#### Scenario: ShowingWritesNothing
- **WHEN** several documents are shown, valid and invalid
- **THEN** the server's data directory is unchanged

#### Scenario: ShowingWithoutTheSecretIsRefused
- **WHEN** a document is shown without the bearer key, or without an identity
- **THEN** the request is refused as the planning tools refuse it, and nothing is embedded

### Requirement: TheToolTeachesEachKind

The tool's description in the published OpenAPI document SHALL carry what a model needs to write each
kind without other documentation: a complete minimal example of a graph, a sequence and a table, and
of a proposal, each taken from a subject unlike a typical request. It SHALL say how a proposal differs
from a description.

#### Scenario: EveryExampleIsShown
- **WHEN** each example in the published description of the tool is shown
- **THEN** every one is accepted
