# Spec Delta

## ADDED Requirements

### Requirement: AProjectMcpServerIsAnExtensionToAllow

An MCP server the project's `.pi/mcp.json` defines SHALL NOT be started or connected until the user has allowed it for its current configuration, and SHALL be asked about like the project's extensions.

#### Scenario: AProjectMcpServerDoesNotStartUntilAllowed
- **GIVEN** a project whose `.pi/mcp.json` defines a stdio server
- **WHEN** a session opens in that project
- **THEN** the server is not started, the interface asks about it naming its command, and once allowed it starts with the rebuilt session; a change to its configuration keeps it out until allowed again
