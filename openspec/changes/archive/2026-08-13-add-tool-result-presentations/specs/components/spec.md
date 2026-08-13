## MODIFIED Requirements

### Requirement: ConversationItemRendering

The component layer SHALL provide dedicated renderers for assistant, user, tool, and custom
conversation items. `AssistantMessage` SHALL support normalized markdown, Mermaid blocks,
workspace-file references, and copy actions. `ToolCard` SHALL delegate the choice of tool
renderer to the tool-result presentation registry rather than enumerating renderers itself,
and SHALL present the selected presentation together with the tool status and access to the
original input and output. When an extension supplies a collapsed rendering for a tool result,
`ToolCard` SHALL use it for the collapsed state. `CustomMessageCard` SHALL support
extension-rendered HTML and normalized markdown.

#### Scenario: AssistantContentIsRendered
- **GIVEN** an assistant item supplied by the application
- **WHEN** `AssistantMessage` renders the item
- **THEN** its supported markdown, diagram, workspace-reference, and copy affordances are presented through the component layer

#### Scenario: ToolOutputUsesSpecializedRenderers
- **GIVEN** a tool item supplied by the application
- **WHEN** `ToolCard` renders the item
- **THEN** it renders the presentation the registry selected for that item
- **AND** it does not itself inspect the tool identity or result shape to choose one

#### Scenario: CollapsedExtensionRenderingIsUsed
- **GIVEN** a tool item carrying a collapsed extension rendering
- **WHEN** `ToolCard` renders the item collapsed
- **THEN** the collapsed extension rendering is the content shown

#### Scenario: CustomExtensionMessageIsRendered
- **GIVEN** a custom conversation item supplied by an extension
- **WHEN** `CustomMessageCard` renders the item
- **THEN** supported rendered HTML or normalized markdown is displayed

### Requirement: SharedPresentationPrimitives

The domain SHALL provide shared presentation primitives for copying text, syntax highlighting,
Mermaid diagrams, unified and split diffs, and rendered HTML. Higher-level components SHALL reuse
these primitives through the observed component relationships instead of embedding duplicate
presentations. `RenderedHtml` SHALL present only HTML produced by the server-side extension
render pipeline; content originating in a tool's own output SHALL NOT be routed to it.

#### Scenario: CopyPresentedText
- **GIVEN** text supplied to `CopyButton`
- **WHEN** the user activates the copy action
- **THEN** the supplied text is the content offered for copying

#### Scenario: RenderCodeWithPathContext
- **GIVEN** source text and a path supplied to `CodeHighlight`
- **WHEN** the component renders
- **THEN** it presents the source using the path as language context

#### Scenario: RenderDiffRows
- **GIVEN** diff lines supplied to `DiffBlock` or `SplitDiffBlock`
- **WHEN** the component renders
- **THEN** the lines are presented in the requested unified or split form

#### Scenario: RenderExtensionHtml
- **GIVEN** rendered HTML supplied to `RenderedHtml` by the extension render pipeline
- **WHEN** the component renders
- **THEN** the HTML is presented through the shared rendered-HTML surface

#### Scenario: ToolOutputIsNotRoutedToRenderedHtml
- **GIVEN** a tool result whose own output contains markup
- **WHEN** a presentation renders that output
- **THEN** the output is presented as inert text rather than through `RenderedHtml`
