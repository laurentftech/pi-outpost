# docker-python-deployment Specification

## Purpose
Ships pi-outpost as a full Docker application with Python and the integrated terminal, released with the CLI, keeping the agent's shell and terminal confined by landstrip and the network under the operator's control.

## Requirements

### Requirement: AutomaticReleaseImage
After successful package publication, the release workflow SHALL build and test the full Linux
x64 image from that release's CLI before pushing the same image to GHCR. It SHALL retain default
unprivileged UID/GID 1000. The CLI tarball SHALL remain internal. Version tags SHALL always be
pushed; latest SHALL move only for stable versions. Anonymous manifest access SHALL be checked.

#### Scenario: FullAppReleaseTagsFollowTheChannel
- **WHEN** a stable or prerelease version is assigned full-app image tags
- **THEN** the exact version tag is present, latest is present only for stable versions, and
  a prerelease naming the latest channel is refused

#### Scenario: ValidatesTheDistributableImage
- **WHEN** the full-app image is tested for release
- **THEN** its actual CLI reports the intended version, its UID/GID are nonzero, and the same
  image passes the real deployment and browser checks before the push step can execute

### Requirement: FullApplicationRecipe
The repository SHALL provide a local Docker/Compose recipe for the full app with pinned pi-outpost,
npm 12.2.2, Python, venv and native terminal bindings. It SHALL run as an unprivileged user, drop
capabilities, use no-new-privileges and publish on loopback without a Docker socket or privileged mode.

#### Scenario: KeepsTheDockerDaemonOutsideTheApp
- **WHEN** the documented Compose recipe starts
- **THEN** the actual container is non-root and not privileged, its capabilities are dropped,
  no Docker socket is mounted, and its published app port binds only to loopback

#### Scenario: UsesPinnedNpmWithNativeBindings
- **WHEN** the built image starts the app
- **THEN** npm reports 12.2.2 and the app's real native PTY opens successfully

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
By default the agent's shell SHALL reach a host only through the server's proxy, which asks the user
about every host the configuration does not list. A policy without a proxy SHALL be closed by the
deployment ceiling. `ALLOW_AGENT_NETWORK=1` SHALL forward the generated policy unchanged, and `0` SHALL
refuse IP networking entirely, proxy ports included. The adapter SHALL only tighten. The choice SHALL be
protected from agent writes. Filesystem and process restrictions SHALL remain unchanged.

#### Scenario: TheAgentIsAskedAboutEveryHostByDefault
- **GIVEN** the shipped default and a fresh `/data` volume
- **WHEN** the container starts, and a policy closed but for a proxy port is run through the deployment ceiling
- **THEN** the configuration holds `sandbox.allowedHosts: []` with grants on, the app starts confined, and the proxy's port is reached while another loopback port is refused — the question itself being `APosixRunnerAsksAboutAnUnlistedHost` under landstrip

#### Scenario: AnExistingConfigurationIsAskedAboutToo
- **GIVEN** the shipped default and an existing `/data/config.json` without `sandbox.allowedHosts`
- **WHEN** the container starts and the agent's shell fetches a public host
- **THEN** `sandbox.allowedHosts: []` has been added to the configuration, and the user is asked about the host

#### Scenario: AgentNetworkNeedsOperatorOptIn
- **GIVEN** the shipped default
- **WHEN** the generated policy permits networking without a proxy port
- **THEN** actual Python bind and connect calls are refused by the deployment ceiling

#### Scenario: AnOperatorOptInFollowsTheConfiguration
- **GIVEN** `ALLOW_AGENT_NETWORK=1` and a configuration without `sandbox.allowedHosts`
- **WHEN** the agent's shell connects to a public host
- **THEN** it is reached without a question, and the configuration is not rewritten

#### Scenario: AnOperatorRefusalClosesTheNetworkEntirely
- **GIVEN** `ALLOW_AGENT_NETWORK=0`
- **WHEN** the generated policy permits networking, or denies it but for a proxy port on which a service listens
- **THEN** actual Python bind and connect calls are refused, the connect to the proxy port included

#### Scenario: HonorsAnExplicitNetworkRefusal
- **GIVEN** an operator opt-in and a caller policy denying networking and local binding
- **WHEN** the runner executes Python bind and connect probes
- **THEN** both calls remain refused; the adapter does not overwrite the caller's restrictions

#### Scenario: AnInvalidNetworkChoiceIsRefused
- **GIVEN** `ALLOW_AGENT_NETWORK` set to anything but `0`, `1` or nothing
- **WHEN** the container starts
- **THEN** it stops with a message naming the accepted values and the default

### Requirement: PersistentProjectAndAgentState
The recipe SHALL bind-mount the existing project and use a separate named volume for agent state
and runtime configuration. Recreating a container SHALL preserve both, including settings changes.

#### Scenario: PersistsProjectsAndAgentState
- **GIVEN** generated project data, stored provider credentials and edited application settings
- **WHEN** the container is recreated with the same volumes
- **THEN** all three remain available and the runtime configuration is not reset to the template
