## ADDED Requirements

### Requirement: Presentation tools are published with a template or their skill

The presentation tools — `pptx_layouts`, `pptx_create` and `pptx_render` — SHALL be published on
demand, together, by the same mechanism as the document extractors, and withdrawn by the same idle
rule.

They SHALL be published before the turn is dispatched when the prompt names a `.potx` path, names a
`.pptx` path (alongside `pptx_extract`), or invokes the skill as `/skill:pptx-from-template`. A
`.potx` SHALL NOT publish `pptx_extract`: a template is not a deck to read.

They SHALL also be published inside the turn when the agent reads the skill's `SKILL.md` — which is
how a model loads a skill on its own — or when a tool call's `path` names a `.pptx` or `.potx`.
Those agent-side triggers SHALL publish only the presentation tools: they SHALL NOT republish an
extractor, which remains the user's to bring back by naming a document.

Talking about presentations without naming a file or the skill SHALL publish nothing.

In the RPC runtime, which cannot change its published toolset, the child SHALL register the three
tools with the others.

#### Scenario: ACodeSessionPublishesNoPresentationTool
- **GIVEN** a session whose prompts name no template and do not invoke the skill
- **WHEN** a turn is sent
- **THEN** none of the presentation tools reaches the model

#### Scenario: NamingATemplatePublishesThePresentationTools
- **WHEN** the user sends a prompt naming a `.potx` path
- **THEN** the three presentation tools reach the model on that turn, and `pptx_extract` does not

#### Scenario: LoadingTheSkillPublishesThemInTheTurn
- **WHEN** the agent reads the skill's `SKILL.md` during a turn
- **THEN** the next request of that same turn carries the three presentation tools

#### Scenario: AgentSideTriggersNeverRepublishTheExtractor
- **WHEN** a tool call's path names a `.pptx`
- **THEN** the presentation tools are published and `pptx_extract` is not

#### Scenario: TheRpcChildRegistersThePresentationTools
- **WHEN** the RPC child builds its toolset
- **THEN** it registers `pptx_layouts`, `pptx_create` and `pptx_render` after `pptx_extract`
