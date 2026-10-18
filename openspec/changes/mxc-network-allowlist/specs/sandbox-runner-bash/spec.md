## ADDED Requirements

### Requirement: AConfinedShellMayReachOnlyNamedHosts

`sandbox.allowedHosts` MAY list host names, exact or as a `*.` suffix. When it is set and MXC's process
container confines the agent's shell, every command SHALL run with outbound traffic denied and the
server's proxy as its only way out, and the proxy SHALL relay a connection to a listed host.

#### Scenario: AnAllowedHostIsReached
- **GIVEN** `sandbox.allowedHosts` naming `registry.npmjs.org`, and the agent's shell confined by MXC
- **WHEN** a command fetches `https://registry.npmjs.org/` with curl, and runs `git ls-remote` against an allowed git host
- **THEN** both succeed, through the server's proxy

#### Scenario: PowerShellFetchesThroughTheProxy
- **GIVEN** the same configuration with a PowerShell `bashShell`
- **WHEN** a command calls `Invoke-WebRequest` on an allowed host without naming a proxy
- **THEN** it succeeds

#### Scenario: NoAllowlistKeepsTheNetwork
- **GIVEN** the agent's shell confined by MXC and no `sandbox.allowedHosts`
- **WHEN** its request is built
- **THEN** outbound traffic is allowed and no proxy is set, as before

### Requirement: AnUnnamedHostIsRefusedAndNothingBypassesTheProxy

Under `sandbox.allowedHosts`, the proxy SHALL refuse a host the list does not name with a response naming
that host and `sandbox.allowedHosts`, and the server SHALL log the refusal. A direct connection, and any
other service on the host's loopback, SHALL be unreachable from a command.

#### Scenario: AnotherHostIsRefusedWithTheReason
- **GIVEN** `sandbox.allowedHosts` and the agent's shell confined by MXC
- **WHEN** a command fetches a host the list does not name
- **THEN** it fails, the proxy's answer names that host and `sandbox.allowedHosts`, and the server logs the refusal

#### Scenario: TheProxyCannotBeBypassed
- **GIVEN** the same configuration
- **WHEN** a command connects to an address directly, ignoring the proxy, or reaches another service listening on the host's loopback
- **THEN** the connection is refused

### Requirement: AnAllowlistNeedsMxcWithoutAnImage

`sandbox.allowedHosts` SHALL be refused at load, with a reason naming the key and what it needs, unless
MXC is the `bashRunner` and no `bashImage` is set: no other backend enforces it here.

#### Scenario: AnAllowlistNeedsMxcWithoutAnImage
- **GIVEN** `sandbox.allowedHosts` with no runner, with landstrip as `bashRunner`, or with `bashImage`
- **WHEN** the configuration is loaded
- **THEN** it is refused with a reason naming the key and what it needs
