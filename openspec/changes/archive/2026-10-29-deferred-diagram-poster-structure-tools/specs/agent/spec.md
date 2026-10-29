# Spec Delta

## ADDED Requirements

### Requirement: Diagram, poster and structured-exchange tools are deferred
The agent tools `drawio_check`, `poster_check`, `poster_pictures`, `compare_timelines`, `write_structure_figure` and `write_structure_table` SHALL be registered with deferred exposure in both runtimes. They SHALL remain loadable through `tool_search` and SHALL not be declared before they are loaded.

#### Scenario: The tools are absent until searched
- **GIVEN** an embedded session that has not loaded any of the six tools
- **WHEN** the model receives its tool declarations
- **THEN** none of the six tools is declared
- **AND** `tool_search` can load each tool by a query for its purpose

#### Scenario: The RPC runtime also defers the tools
- **GIVEN** an RPC session before any of the six tools has been loaded
- **WHEN** the model receives its tool declarations
- **THEN** none of the six tools is declared
- **AND** `tool_search` can load each tool by a query for its purpose

### Requirement: The agent is told which deferred tool families it can search for
When `tool_search` is available, the product-owned system guidance SHALL tell the agent that diagram, poster and structured-exchange tools can be loaded with it.

#### Scenario: Guidance names the deferred tool families
- **GIVEN** a session where `tool_search` is available
- **WHEN** the product-owned system guidance is composed
- **THEN** it names diagram, poster and structured-exchange tools and says to load needed tools with `tool_search`

#### Scenario: Guidance is absent when tool search is unavailable
- **GIVEN** a session where `tool_search` is unavailable
- **WHEN** the product-owned system guidance is composed
- **THEN** it does not advertise these tool families as searchable
