# Spec Delta

## MODIFIED Requirements

### Requirement: AReadableServerEnvironmentIsJudgedByWhatItHolds

When the only attempt that got through is reading the server's process environment (as under
landstrip before 0.20 on Linux; 0.20 hides the server's process), the verdict SHALL depend on what
that environment holds: with no secret-looking variable, the lock SHALL be shown closed and say the
environment is readable but holds no secret; with some, it SHALL be shown partly confined, naming
those variables and never their values.

#### Scenario: AReadableEnvironmentWithoutSecretsKeepsTheLock
- **GIVEN** a runner under which a command can read the server's process environment, and a server environment with no key, token, secret or password
- **WHEN** the canary runs
- **THEN** the lock is closed, and its description says the server's environment is readable and holds no secret

#### Scenario: SecretsInAReadableEnvironmentAreNamed
- **GIVEN** the same runner, and a server started with `OPENAI_API_KEY` in its environment
- **WHEN** the canary runs
- **THEN** the lock is shown partly confined, naming `OPENAI_API_KEY` and not its value, and `doctor` reports it as a warning

## ADDED Requirements

### Requirement: ALandstripRefusalIsToldInWords

Under landstrip, each refusal landstrip reports on stderr SHALL reach the agent as one line naming
the operation and its target, saying the sandbox refused it and that the command went on, instead of
landstrip's JSON. Every other line of the command's output SHALL pass unchanged.

#### Scenario: ALandstripRefusalIsToldInWords
- **GIVEN** `bash` confined by the real landstrip runner on Linux
- **WHEN** a command makes a `bind` the sandbox refuses and survives it, and writes beside the root
- **THEN** its output holds `[sandbox] refused bind [::1]:0` and `[sandbox] refused write <path>`, no landstrip JSON, and its exit status is the command's own

### Requirement: TheStartupLineSaysAnEmptyListAsks

The server's startup line SHALL describe the agent's network as it behaves. With
`sandbox.allowedHosts` empty, it SHALL say every host is asked about under host questions, and that
the network is closed without them. With hosts listed, it SHALL name those hosts, and say the others
are asked about when they are.

#### Scenario: TheStartupLineSaysAnEmptyListAsks
- **GIVEN** `sandbox.allowedHosts: []` under a runner that takes host questions
- **WHEN** the server starts
- **THEN** the sandbox line says every host is asked about, and with `sandbox.grants: "never"` it says the network is closed
