## ADDED Requirements

### Requirement: Terminal configuration and opt-in

The server configuration SHALL provide an explicit `terminal.enabled` setting, defaulting to `false`.

#### Scenario: Default configuration disables terminal
- **GIVEN** a configuration file with no `terminal` section
- **WHEN** the server loads the configuration
- **THEN** `config.terminal.enabled` is `false`

#### Scenario: Command-line flag and environment variable override
- **WHEN** the server is launched with `--terminal` or `PI_OUTPOST_TERMINAL=1`
- **THEN** `config.terminal.enabled` is set to `true`
- **WHEN** the server is launched with `--no-terminal` or `PI_OUTPOST_TERMINAL=0`
- **THEN** `config.terminal.enabled` is set to `false`

#### Scenario: Sandbox lock prevents terminal tampering
- **GIVEN** `sandboxLocks.terminal: true` in server configuration
- **THEN** client settings cannot enable or unlock the terminal feature
