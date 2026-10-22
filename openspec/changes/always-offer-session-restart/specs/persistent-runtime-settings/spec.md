## ADDED Requirements

### Requirement: ManualSessionRestart
Settings SHALL offer Restart session without requiring edited settings or a configured sandbox, in standalone and embedded interfaces. The action SHALL explicitly reload extension resources and MCP configuration, then create a fresh session, without persisting configuration. Changed sandbox drafts SHALL retain Apply & restart session. Failures and vetoes SHALL stay visible; busy/concurrent restarts SHALL be refused. Unsupported runtimes SHALL report that limitation.

#### Scenario: RestartWithoutChanges
- **GIVEN** unchanged settings and an extension edited on disk
- **WHEN** Restart session is selected
- **THEN** a fresh session loads the edited extension and the configuration file is byte-identical

#### Scenario: RestartWithoutSandbox
- **GIVEN** a widget or standalone server with no sandbox
- **WHEN** Settings opens
- **THEN** Restart session is available and can create a fresh session

#### Scenario: RestartMcp
- **GIVEN** a connected MCP server and an edited mcp.json
- **WHEN** the session restarts
- **THEN** the replacement MCP integration connects the server from the new configuration

#### Scenario: RestartVeto
- **GIVEN** an extension vetoes session replacement
- **WHEN** a restart is requested
- **THEN** an error is shown and the previous session remains active

#### Scenario: RestartInProgress
- **GIVEN** a restart is in progress
- **WHEN** another restart is attempted
- **THEN** the UI disables its control and the server refuses a concurrent request
