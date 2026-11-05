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
documentation SHALL describe the deployment's operator-controlled agent IP network ceiling.

#### Scenario: RunsPythonInTheConfinedTerminal
- **WHEN** the user creates a venv and executes Python in the app's real terminal
- **THEN** the command runs and its output file lands in the host project; a Python HTTP server can
  serve that file after operator opt-in through an explicitly published loopback port, and Ctrl+C interrupts a process
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

### Requirement: OperatorControlledNetwork
IP networking in the agent's shell and terminal SHALL be denied by default. The adapter SHALL only tighten the generated
single-file policy. With explicit operator opt-in it SHALL forward the caller's policy unchanged,
never turn a denied permission on. The operator choice SHALL be protected from agent writes.
Filesystem and process restrictions SHALL remain unchanged.

#### Scenario: AgentNetworkNeedsOperatorOptIn
- **GIVEN** the shipped default with no operator opt-in
- **WHEN** the generated policy permits networking
- **THEN** actual Python bind and connect calls are still refused by the deployment ceiling

#### Scenario: HonorsAnExplicitNetworkRefusal
- **GIVEN** an operator opt-in and a caller policy denying networking and local binding
- **WHEN** the runner executes Python bind and connect probes
- **THEN** both calls remain refused; the adapter does not overwrite the caller's restrictions

### Requirement: PersistentProjectAndAgentState
The recipe SHALL bind-mount the existing project and use a separate named volume for agent state
and runtime configuration. Recreating a container SHALL preserve both, including settings changes.

#### Scenario: PersistsProjectsAndAgentState
- **GIVEN** generated project data, stored provider credentials and edited application settings
- **WHEN** the container is recreated with the same volumes
- **THEN** all three remain available and the runtime configuration is not reset to the template
