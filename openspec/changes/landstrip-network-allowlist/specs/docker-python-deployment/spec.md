# Spec Delta

## MODIFIED Requirements

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
