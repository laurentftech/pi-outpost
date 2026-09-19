# structured-exchange-in-replies Specification

## Purpose
Draws a structured-exchange document that the agent wrote directly into its reply, as it would draw one presented through the tool, so a model that writes the document instead of calling the tool still shows the reader a diagram rather than raw JSON.

## Requirements

### Requirement: AStructuredExchangeBlockInAReplyIsDrawn

A fenced block in an assistant reply whose info string is `json` and whose content is a JSON object declaring a structured-exchange `schema` SHALL be validated against the same contract as a document presented through the tool, and when it is valid SHALL be rendered in place with the same presentation a presented document receives: its view, the reader's controls, its accessible textual equivalent and its derived exports. The block's source SHALL remain reachable from the rendering. Any other fenced block, JSON included, SHALL be shown as code. The system SHALL NOT infer a document from text outside such a block.

#### Scenario: AValidBlockIsDrawn
- **GIVEN** a reply containing a ```` ```json ```` block that is a valid structured-exchange graph
- **WHEN** the reply is shown
- **THEN** the graph is drawn in place of the block, with its textual equivalent, and its source is one action away

#### Scenario: OrdinaryJsonStaysCode
- **GIVEN** a reply containing a ```` ```json ```` block that declares no structured-exchange schema
- **WHEN** the reply is shown
- **THEN** the block is shown as code

#### Scenario: ARestoredReplyIsDrawnToo
- **GIVEN** a saved conversation whose reply contains a valid structured-exchange block
- **WHEN** the conversation is opened again
- **THEN** the block is drawn as it was when the reply arrived

### Requirement: AnIncompleteOrFailingBlockStaysReadable

While a reply is streaming, a structured-exchange block that is not yet complete SHALL be shown as code, and SHALL be drawn once it is complete and valid. A block that declares a structured-exchange schema and fails validation, or declares a version this application does not implement, SHALL be shown as code with one line stating that it is a structured-exchange document that could not be drawn and the first reason.

#### Scenario: AStreamingBlockIsDrawnWhenComplete
- **GIVEN** a reply whose structured-exchange block is still arriving
- **WHEN** the block is incomplete
- **THEN** it is shown as code, and once the block is complete and valid it is drawn

#### Scenario: AFailingBlockSaysWhy
- **GIVEN** a reply containing a ```` ```json ```` block that declares the structured-exchange schema but relates an element that does not exist
- **WHEN** the reply is shown
- **THEN** the block is shown as code under a line saying it could not be drawn, naming the first rule it breaks

### Requirement: ABlockInAReplyIsHeldToTheProjectProfile

In a project that registers profiles, a drawn structured-exchange block SHALL carry the same statement a presented document carries — the profile it was checked against and whether it conforms, strays, or could not be checked — established by the server against the project's registry as it is when the reply is shown, live or restored. A block not held to a profile SHALL carry no statement, and the statement SHALL be carried beside the block, never inside it.

#### Scenario: AConformingBlockSaysSo
- **GIVEN** a project holding documents to `acme/requirements`, and a reply containing a block that conforms to it
- **WHEN** the reply is shown
- **THEN** the drawn block states that it conforms to `acme/requirements`

#### Scenario: AStrayingBlockSaysSo
- **GIVEN** a project holding documents to `acme/requirements`, and a reply containing a block that uses a kind the profile does not declare
- **WHEN** the reply is shown
- **THEN** the drawn block states that it does not conform to `acme/requirements`

#### Scenario: AProjectWithoutProfilesSaysNothing
- **GIVEN** a project that registers no profile
- **WHEN** a reply containing a valid block is shown
- **THEN** the block is drawn and carries no conformance statement
