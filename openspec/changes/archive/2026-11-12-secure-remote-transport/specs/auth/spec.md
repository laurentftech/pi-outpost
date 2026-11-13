# Auth delta

## MODIFIED Requirements

### Requirement: OptionalSharedToken

The system SHALL support a shared-secret token, configured as `server.token` and overridden by `PI_OUTPOST_TOKEN` (env wins). Empty tokens MUST be rejected at config load. A token MAY be omitted on literal loopback listeners; it SHALL be required on non-loopback listeners, including native TLS or explicitly permitted plaintext protected hops.

#### Scenario: EnvOverridesConfig
- **WHEN** both server.token and PI_OUTPOST_TOKEN are set
- **THEN** the environment variable's value is the effective token

#### Scenario: NoTokenConfigured
- **WHEN** neither server.token nor PI_OUTPOST_TOKEN is set on a literal loopback listener
- **THEN** endpoints require no credential and retain their Origin and confinement controls
