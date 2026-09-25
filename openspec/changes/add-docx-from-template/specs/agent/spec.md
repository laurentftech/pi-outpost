## ADDED Requirements

### Requirement: WordTemplateToolsArePublishedOnDemand

`docx_styles`, `docx_create` and `docx_render` SHALL be published together when a prompt names a
`.dotx` file, when it names a `.docx` file (with `docx_extract`), when it invokes
`/skill:docx-from-template`, or when, within a turn, the agent reads that skill's `SKILL.md` or
calls a tool with a `.docx`/`.dotx` path. A trigger from the agent's side SHALL NOT republish
`docx_extract`. `docx_create` SHALL NOT be registered where writing is disabled.

#### Scenario: NamingAWordTemplatePublishesTheTools
- **WHEN** a prompt names `report.dotx`
- **THEN** the three template tools are published for that turn, and `docx_extract` is not

#### Scenario: ReadingTheSkillPublishesTheToolsWithinTheTurn
- **WHEN** the agent reads `skills/docx-from-template/SKILL.md`
- **THEN** the next request in the same turn carries the three template tools

#### Scenario: NoWordCreationInAReadOnlySandbox
- **GIVEN** a sandbox where writing is disabled
- **WHEN** the tools are registered
- **THEN** `docx_create` is absent and the two others are present
