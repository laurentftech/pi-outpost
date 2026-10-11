## MODIFIED Requirements

### Requirement: ToolsAreDescribedForOpenWebUI

The server SHALL publish an OpenAPI description from which Open WebUI builds one tool per operation:
the planning tools (list, create, get, update and show), the structure tools (show a structure, read
the guide) and the document tools (create and update a Word document, create and update a PowerPoint
deck, list the kept documents, list the templates). Each tool description SHALL carry what a model needs to use it correctly without other
documentation, including a complete minimal timeline for creation, a complete update example, and a
complete example for each document tool.

#### Scenario: TheDescriptionNamesTheFiveTools
- **WHEN** the OpenAPI description is fetched
- **THEN** it declares exactly the planning, structure and document operations, each with a
  description and an input schema

#### Scenario: TheCreationExampleIsValid
- **WHEN** the timeline example in the creation tool's description is created as a planning
- **THEN** it is accepted

#### Scenario: TheUpdateExampleApplies
- **WHEN** the update example in the update tool's description is applied to the planning created from
  the creation example
- **THEN** it is accepted

#### Scenario: TheDocumentExamplesAreWritten
- **WHEN** the examples in the descriptions of `create_document` and `create_presentation` are called
- **THEN** each answers with an embedded file, its Mermaid diagram drawn and its picture embedded
