# Delta: model — auth-token

## MODIFIED Requirements

### Requirement: AppConfigValidation

> Implementation: `loadConfig` in `server/src/config.ts` · confidence: reviewed

The system SHALL validate AppConfig on load according to these rules:
- Config is read from `pi-outpost.config.json` in the base cwd, or from the file named by the `PI_OUTPOST_CONFIG` env variable; missing file yields defaults
- Every typed field is checked (strings non-empty, booleans, string arrays); violations throw an error prefixed `[config]`
- Path fields (cwd, agentDir, sandbox.root, sandbox.writableRoot) are resolved to absolute paths
- `server.token`, when present, must be a non-empty string; the `PI_OUTPOST_TOKEN` environment variable overrides it

#### Scenario: LoadApplicationConfiguration
- **GIVEN** A valid config file
- **WHEN** loadConfig is called
- **THEN** AppConfig is loaded with cwd, sandbox, branding, server, and tool settings applied
- **AND** If a field has the wrong type, an error prefixed `[config]` is thrown

#### Scenario: TokenFromEnvironment
- **GIVEN** PI_OUTPOST_TOKEN is set in the environment
- **WHEN** loadConfig is called
- **THEN** The effective token is the environment value, regardless of server.token
