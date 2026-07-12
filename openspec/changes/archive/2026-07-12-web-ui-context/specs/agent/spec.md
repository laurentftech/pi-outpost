# Delta: agent

## ADDED Requirements

### Requirement: WebUIContextInjection

The server SHALL prepend a web-UI context block to the agent's system prompt at session creation, ahead of any operator-configured `appendSystemPrompt` entries. The block SHALL describe rendering capabilities only (markdown/math/mermaid rendering, file links opening in the viewer, inline display of workspace-relative image references) and SHALL NOT grant or imply any additional permissions. Injection SHALL be disabled when the top-level config key `webContext` is `false` (default `true`).

#### Scenario: DefaultInjection
- **GIVEN** a server started without a `webContext` config key
- **WHEN** the agent session is created
- **THEN** the system prompt contains the web-UI context block before any operator `appendSystemPrompt` entries

#### Scenario: OptOut
- **GIVEN** a config with `"webContext": false`
- **WHEN** the agent session is created
- **THEN** the system prompt contains only the operator's `appendSystemPrompt` entries, unchanged from prior behavior

#### Scenario: OperatorEntriesPreserved
- **GIVEN** a config with `appendSystemPrompt: ["Only discuss this project."]`
- **WHEN** the agent session is created with injection enabled
- **THEN** the operator entry is still present, after the web-UI context block
