## ADDED Requirements

### Requirement: OnLinuxMxcMayConfineBash

On Linux, `"mxc"` SHALL name the installed MXC Linux executor (`lxc-exec`) for this architecture, and a
path whose file is `lxc-exec` SHALL name MXC too. Its commands SHALL run in MXC's Bubblewrap backend with
the same limits as a confined command elsewhere: the root writable or read-only, the agent directory and
the configuration denied, the minimal environment for the command and for the runner, and none of the
server's processes visible.

#### Scenario: MxcNamesTheLinuxExecutor
- **GIVEN** a Linux host with `@microsoft/mxc-sdk` installed
- **WHEN** the configuration names `"mxc"` as `sandbox.bashRunner`, or a path ending in `lxc-exec`
- **THEN** it resolves to the package's `lxc-exec` for this architecture, and is treated as MXC

#### Scenario: OnLinuxACommandCannotReadOutsideTheRoot
- **GIVEN** `bash` confined by MXC's real Linux executor in a container that allows it, a file beside the root and an agent directory with a key
- **WHEN** a command reads both, writes in the root and beside it, lists the processes it sees, and runs git
- **THEN** both reads fail, only the write in the root lands, no server process and no key is visible, and git answers

### Requirement: OnLinuxAnMxcHostThatCannotConfineIsRefused

The Linux self-check SHALL run one confined command with the network shape the configuration needs, and
a host that cannot run it SHALL make every command refuse with MXC's own reason.

#### Scenario: AContainerWithoutNamespacesRefusesWithTheReason
- **GIVEN** MXC as `bashRunner` in a Docker container with the default seccomp and AppArmor profiles
- **WHEN** a command is run
- **THEN** it is refused, and the reason names the user namespaces the host refused

### Requirement: OnLinuxTheNetworkFollowsAllowedHosts

Under MXC on Linux, the agent's shell SHALL keep an open network without `sandbox.allowedHosts`, and with
it SHALL reach only the listed hosts through the server's proxy, with outbound and inbound traffic denied.

#### Scenario: OnLinuxAnAllowedHostIsReachedAndOthersAreRefused
- **GIVEN** `sandbox.allowedHosts` naming `registry.npmjs.org`, and `bash` confined by MXC's real Linux executor
- **WHEN** a command fetches that host, an unlisted host, and that host again ignoring the proxy, and reaches another service on the container's loopback
- **THEN** only the first succeeds, through the proxy, and the output ends with the note naming the unlisted host

#### Scenario: OnLinuxWithoutAnAllowlistTheNetworkIsOpen
- **GIVEN** `bash` confined by MXC on Linux and no `sandbox.allowedHosts`
- **WHEN** its request is built
- **THEN** outbound traffic is allowed and no proxy is set
