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

### Requirement: ARefusedSecurityEnvironmentStepsEnumerationDown

Under MXC on Windows, when Windows refuses to build the process security environment for the policy —
one of its paths cannot be opened or resolved there, reported by the SDK as
`CreateProcessSecurityEnvironment failed (HRESULT = 0x8007…)`, nothing having run — the command SHALL be
replayed at a lower enumeration level: first without the ancestors of the grants (the sandbox cache and
toolchain homes, whose enumerated folders sit under the profile), then without any listable folder
(`enumeratePaths` and the entries denied beside the way down in them) — the policy sent before the layer.
At every level the confinement is the same: the siblings of the path to the root, the agent directory and
the configuration SHALL stay denied, and nothing SHALL run unconfined. A refusal with nothing enumerated,
or any other failure, SHALL NOT be replayed. Once a lower level has run on a host, no policy built
afterwards on that host SHALL ask past it.

#### Scenario: ARefusedSecurityEnvironmentStepsEnumerationDown
- **GIVEN** the agent's shell confined by MXC on Windows, a tool beside the root on another drive than the root's and a granted directory beside it (the policy enumerates the folders above both), and a host where `CreateProcessSecurityEnvironment` fails with 0x80070005 on that policy (measured on a domain-joined account)
- **WHEN** a command runs
- **THEN** it runs first on the policy without the grant ancestors' enumeration (the tools' ancestors still listable), and if that is refused too, on the policy without any `enumeratePaths` — with the agent directory and the configuration still denied by name, and the command's own exit code and output; a later policy built on the host stays at the level that ran; and a refusal with nothing enumerated, or another failure, is the command's error, not a replay

### Requirement: AToolBehindALinkOnTheWayDownResolves

Under MXC on Windows, where MXC can enumerate a folder without reading it, when a folder a command opens by
path beside the root is itself a link on the way down (scoop's `current` junction to the active version,
nvm-windows' folder), the link's target SHALL be readable like the link, so a path resolved through the
junction reaches it; the link itself SHALL never be enumerated, because listing it would show its target's
children, each then denied by name; and everything else beside the way down SHALL stay denied.

#### Scenario: AToolBehindALinkOnTheWayDownResolves
- **GIVEN** the agent's PowerShell confined by MXC on Windows 11 tier 1, scoop installed in a denied sibling of the root (`D:\WRK\Scoop` beside `D:\Python\isai_oper`), its `shims` and `apps\nodejs\current\bin` on `PATH`, and `current` a junction to `apps\nodejs\<version>`
- **WHEN** a command resolves `node` on `PATH` (PowerShell's command lookup queries the folder) and runs a Node CLI shim that calls `node.exe` by name
- **THEN** `node.exe` is found through the junction and runs — the target `apps\nodejs\<version>` is readable, never denied as beside the way, while `node.exe` stays directly executable by its full path too; and the folders beside the way down (`Scoop\buckets`, the other apps' version folders) stay denied by name

### Requirement: TheIntranetIsReachable

Under MXC on Windows without `sandbox.allowedHosts`, the agent's shell and the confined terminal SHALL reach
the private network only when the user set `sandbox.privateNetwork` to `true`, independently of
`sandbox.hostLoopback`. Absent, it SHALL stay closed.

#### Scenario: TheIntranetIsReachable
- **GIVEN** the agent's PowerShell confined by MXC on Windows 11 tier 1 on a private IPv4 network, without `sandbox.allowedHosts`
- **WHEN** a command connects to another address of that network, by default and with `sandbox.privateNetwork: true`
- **THEN** the sandbox refuses it (WSAEACCES) by default, and does not refuse it when the key is true

#### Scenario: PrivateNetworkMustBeABoolean
- **GIVEN** `sandbox.privateNetwork: "no"`
- **WHEN** the configuration is loaded
- **THEN** it is refused with a reason naming the key

### Requirement: ASandboxRefusalIsNamed

Under MXC on Windows, when a command fails and a host it names falls where the sandbox's own network
policy refuses it, the output SHALL end with a note naming that host, the setting that refuses it, and
that it is not a network failure, whatever the program printed. Where no host can be named but the
output shows the sandbox's refusal, the note SHALL say so without a host. A refused connection SHALL NOT
offer a file diagnosis.

#### Scenario: ASandboxRefusalIsNamed
- **GIVEN** the agent's PowerShell confined by MXC on Windows 11 tier 1, the private network closed by default
- **WHEN** a command connects to another address of the machine's private subnet, with .NET's own error, and with curl, which prints only that it could not connect
- **THEN** each output ends with the note naming that address and `sandbox.privateNetwork`, and offers no diagnosis; a command that met no refusal gets none

### Requirement: TheUsersMirrorIsSeen

Under MXC on Windows, before each command and confined terminal, the user's configuration of the package
managers the sandbox sets up SHALL be copied where the confined tool reads it, every credential taken out,
following the original's edits and removal. No credential of those files SHALL reach a command.

#### Scenario: TheUsersMirrorIsSeen
- **GIVEN** the user's `uv.toml`, `pip.ini`, `.npmrc`, Cargo `config.toml`, Go `env` and `NuGet.Config` naming a company's mirror, each with credentials
- **WHEN** a command of the agent's PowerShell confined by MXC asks uv, pip, npm, Cargo, Go and dotnet for their configuration
- **THEN** each names the company's mirror, and no credential appears in the command's output or in the copies it can read

### Requirement: TheCredentialsStayInTheServer

A registry the user's configuration authenticates to SHALL be named in the copy as the server's
registry relay, which SHALL add the credentials to each request it forwards. The relay SHALL forward
only `GET` and `HEAD`, only to registries the user's files name, and only under its own key; it SHALL
return no cookie and point the registry's links at itself.

#### Scenario: TheCredentialsStayInTheServer
- **GIVEN** the user's `.npmrc` with an `_authToken` and `uv.toml` with a password for a registry that refuses requests without them
- **WHEN** a command of the agent's PowerShell confined by MXC installs a package from each, on the loopback and under `sandbox.allowedHosts`, and tries a `PUT`
- **THEN** both install; no credential appears in its output nor in the copies; the `PUT` is answered 405 and never reaches the registry

### Requirement: ARedirectedStderrIsNoFailure

A PowerShell command of the agent's shell whose only errors are a native program's lines written to a
redirected stderr (`2>&1`), the program having exited 0, SHALL end with status 0. A native program's own
non-zero code SHALL still be the command's, and a failed cmdlet SHALL still end it with 1.

#### Scenario: ARedirectedStderrIsNoFailure
- **GIVEN** the agent's shell running Windows PowerShell 5.1 or PowerShell 7
- **WHEN** a command runs a native program that writes to stderr and exits 0, redirected with `2>&1`; the same exiting 4; and a failing cmdlet after it
- **THEN** the first ends 0 with the stderr line shown, the second 4, the third 1

### Requirement: TheCompanyProxyReachesTheCommand

When no `sandbox.allowedHosts` proxy is a confined command's way out, it SHALL get the server's proxy
variables (`HTTPS_PROXY`, `HTTP_PROXY`, `ALL_PROXY`, `NO_PROXY`, either case), except one naming a user or
password, which the startup line SHALL name as left out. Under `allowedHosts` it SHALL get none of them.

#### Scenario: TheCompanyProxyReachesTheCommand
- **GIVEN** a server started with `HTTPS_PROXY` naming a proxy, `NO_PROXY`, and `http_proxy` carrying a password
- **WHEN** a confined command's environment is built without and with an `allowedHosts` proxy
- **THEN** without, it holds `HTTPS_PROXY` and `NO_PROXY` and not `http_proxy`; with, none of them
