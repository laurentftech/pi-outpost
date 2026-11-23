# Spec Delta

## ADDED Requirements

### Requirement: AToolBesideTheRootResolves

Under MXC on Windows, where MXC can enumerate a folder without reading it, the folders above each folder a
command opens by path beside the root — the search path's tools, their installations, the shell's folder and
the grants — SHALL be enumerable, so the tool's path resolves, unless the root's readable drive already
covers them. Everything else in an enumerated folder SHALL stay denied, and the agent directory and the
configuration file SHALL never be enumerated.

#### Scenario: AToolBesideTheRootResolves
- **GIVEN** the agent's PowerShell confined by MXC on Windows 11 tier 1, and a launcher on `PATH` in a folder beside the root that runs a Node script of its own
- **WHEN** a command runs the launcher, then reads a file and lists a folder beside the way down to it
- **THEN** the script runs and resolves its real path; the file and the folder are refused

### Requirement: TheIntranetIsReachable

Under MXC on Windows without `sandbox.allowedHosts`, the agent's shell and the confined terminal SHALL reach
the private network, unless `sandbox.privateNetwork` is `false`, independently of `sandbox.hostLoopback`.

#### Scenario: TheIntranetIsReachable
- **GIVEN** the agent's PowerShell confined by MXC on Windows 11 tier 1 on a private IPv4 network, without `sandbox.allowedHosts`
- **WHEN** a command connects to another address of that network, by default and with `sandbox.privateNetwork: false`
- **THEN** the sandbox does not refuse it by default, and refuses it (WSAEACCES) when the key is false

#### Scenario: PrivateNetworkMustBeABoolean
- **GIVEN** `sandbox.privateNetwork: "no"`
- **WHEN** the configuration is loaded
- **THEN** it is refused with a reason naming the key

### Requirement: ASandboxRefusalIsNamed

Under MXC on Windows, when a command's output reports a connection refused with WSAEACCES (10013), the
output SHALL end with a note saying the sandbox refused it, that it is not a network failure, and what this
sandbox opens — unless the proxy already named the refused host.

#### Scenario: ASandboxRefusalIsNamed
- **GIVEN** the agent's PowerShell confined by MXC on Windows 11 tier 1 with `sandbox.privateNetwork: false`
- **WHEN** a command's connection to the private network is refused and it prints the error
- **THEN** its output ends with the note naming the sandbox and `sandbox.privateNetwork`; a command that met no refusal gets none

### Requirement: TheCompanyProxyReachesTheCommand

When no `sandbox.allowedHosts` proxy is a confined command's way out, it SHALL get the server's proxy
variables (`HTTPS_PROXY`, `HTTP_PROXY`, `ALL_PROXY`, `NO_PROXY`, either case), except one naming a user or
password, which the startup line SHALL name as left out. Under `allowedHosts` it SHALL get none of them.

#### Scenario: TheCompanyProxyReachesTheCommand
- **GIVEN** a server started with `HTTPS_PROXY` naming a proxy, `NO_PROXY`, and `http_proxy` carrying a password
- **WHEN** a confined command's environment is built without and with an `allowedHosts` proxy
- **THEN** without, it holds `HTTPS_PROXY` and `NO_PROXY` and not `http_proxy`; with, none of them
