# Spec Delta

## MODIFIED Requirements

### Requirement: Non-interactive git execution

Every git process this capability spawns SHALL run non-interactively: it SHALL NOT be able
to prompt for a passphrase or password, on its own terminal or through an askpass helper,
and SHALL NOT inherit an interactive terminal from the server process. A repository whose
address requires credentials the deployment has not already provided SHALL fail within the
bounded execution time rather than waiting for input, with a display-safe reason that names
the host and says the failure is one of authentication when git reports it as such.

Credentials the deployment has configured for git itself — a credential helper storing
them without prompting, an SSH agent, a key without a passphrase — SHALL keep working and
SHALL be consulted before any credential this system stores, and this system SHALL NOT copy
them. HTTPS credentials this system keeps per Git host, as described by the git-host-credentials
capability, SHALL be offered to these git processes after the deployment's own. Credentials
embedded in an address SHALL NOT be logged or returned to a client, and SHALL NOT be written to
the clone's configured remote; they SHALL be kept only in that store.

#### Scenario: A repository needing credentials fails instead of waiting
- **WHEN** a clone or fetch reaches a repository that would prompt for a password or passphrase
- **THEN** the operation fails with a display-safe reason and no prompt is issued
- **AND** the server does not block until its command timeout waiting for input

#### Scenario: Configured git authentication still works
- **GIVEN** a deployment whose git authentication answers without prompting
- **WHEN** a repository is cloned or refreshed
- **THEN** the operation succeeds without this system asking for or storing credentials

#### Scenario: An authentication failure is named
- **GIVEN** an HTTPS repository requiring authentication and no credential available for its host
- **WHEN** it is cloned
- **THEN** the failure names the host and says it requires authentication, rather than showing git's progress line
- **AND** no embedded credential appears in the message
