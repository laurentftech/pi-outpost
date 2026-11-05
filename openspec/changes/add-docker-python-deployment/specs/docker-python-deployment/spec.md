## ADDED Requirements

### Requirement: FullApplicationRecipe
The repository SHALL provide a local Docker/Compose recipe for the full app with pinned pi-outpost,
npm 12.2.1, Python, venv and native terminal bindings. It SHALL run as an unprivileged user, drop
capabilities, use no-new-privileges and publish on loopback without a Docker socket or privileged mode.

#### Scenario: KeepsTheDockerDaemonOutsideTheApp
- **WHEN** the documented Compose recipe starts
- **THEN** the actual container is non-root and not privileged, its capabilities are dropped,
  no Docker socket is mounted, and its published app port binds only to loopback

#### Scenario: UsesPinnedNpmWithNativeBindings
- **WHEN** the built image starts the app
- **THEN** npm reports 12.2.1 and the app's real native PTY opens successfully

### Requirement: ConfinedPythonAndTerminal
The agent's shell and interactive terminal SHALL use landstrip with the project's policy. The recipe
SHALL refuse startup if either real confinement canary is not verified. It SHALL read the web token
from a secret file into protected config, not expose it in the server's environment or logs. The
documentation SHALL explicitly state that outbound networking remains open.

#### Scenario: RunsPythonInTheConfinedTerminal
- **WHEN** the user creates a venv and executes Python in the app's real terminal
- **THEN** the command runs and its output file lands in the host project; a Python HTTP server can
  serve that file through an explicitly published loopback port, and Ctrl+C interrupts a process
  without breaking subsequent commands

#### Scenario: ProtectsCredentialsAndConfiguration
- **GIVEN** existing credentials, a config file, a secret file and data outside the project
- **WHEN** a command in the app's terminal tries reading them or writing outside the project
- **THEN** those accesses are refused and no web token appears in the logs or server environment

#### Scenario: RefusesMissingCredentialsOrUnverifiedConfinement
- **WHEN** the token file is missing or the configured shell runner cannot verify confinement
- **THEN** the container exits unsuccessfully before serving, with a reason and no unconfined fallback

#### Scenario: PreservesTheBrowserTerminal
- **WHEN** the user executes Python, interrupts a process, opens/closes tabs and reconnects in the app
- **THEN** real output remains observable, a live terminal can be opened after reconnect, and closed
  terminals are not silently revived

### Requirement: PersistentProjectAndAgentState
The recipe SHALL bind-mount the existing project and use a separate named volume for agent state
and runtime configuration. Recreating a container SHALL preserve both, including settings changes.

#### Scenario: PersistsProjectsAndAgentState
- **GIVEN** generated project data, stored provider credentials and edited application settings
- **WHEN** the container is recreated with the same volumes
- **THEN** all three remain available and the runtime configuration is not reset to the template
