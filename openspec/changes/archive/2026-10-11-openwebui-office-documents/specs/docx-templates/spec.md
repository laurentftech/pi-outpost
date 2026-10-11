## ADDED Requirements

### Requirement: MermaidDiagramsAreDrawnInWordDocuments

`docx_create` and `docx_update` SHALL draw a ` ```mermaid ` fence as a picture in its place, an SVG
with a PNG behind it, with the Open WebUI document tools' renderer. A fence that cannot be drawn
SHALL be written as its source and named in the answer with the reason; an installation without the
renderer SHALL write every fence as its source and say so.

#### Scenario: AMermaidFenceBecomesAPicture
- **WHEN** `docx_create` is called with Markdown holding a valid flowchart in a ` ```mermaid ` fence, or `docx_update` appends one
- **THEN** the document holds, in that place, an SVG picture carrying the diagram's labels and a PNG behind it, the source is not written, and the answer has no note about it

#### Scenario: AnUndrawableMermaidIsNamed
- **WHEN** `docx_create` is called with a ` ```mermaid ` fence whose source does not parse
- **THEN** the document holds the source as code, and the answer notes that diagram 1 could not be drawn, with Mermaid's message

#### Scenario: WithoutARendererTheSourceStays
- **GIVEN** an installation that cannot draw Mermaid
- **WHEN** `docx_create` is called with a ` ```mermaid ` fence
- **THEN** the document holds the source as code and no picture, and the answer says this installation cannot draw Mermaid diagrams
