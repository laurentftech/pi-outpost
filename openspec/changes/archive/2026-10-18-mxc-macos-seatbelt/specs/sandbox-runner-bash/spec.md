## ADDED Requirements

### Requirement: OnMacOsMxcMayConfineBash

On macOS on Apple silicon, `"mxc"` SHALL name the installed MXC macOS executor (`mxc-exec-mac`), and a
path whose file is `mxc-exec-mac` SHALL name MXC too. Its commands SHALL run under Seatbelt with the
limits of a confined command elsewhere, and SHALL signal no process outside the command.

#### Scenario: MxcNamesTheMacOsExecutor
- **GIVEN** a Mac on Apple silicon with `@microsoft/mxc-sdk` installed
- **WHEN** the configuration names `"mxc"` as `sandbox.bashRunner`, or a path ending in `mxc-exec-mac`
- **THEN** it resolves to the package's `mxc-exec-mac`, and is treated as MXC

#### Scenario: OnAnIntelMacMxcIsRefused
- **GIVEN** a Mac on an Intel processor
- **WHEN** the configuration names `"mxc"` as `sandbox.bashRunner`
- **THEN** loading the configuration fails, saying MXC has no executor for this architecture

#### Scenario: OnMacOsACommandCannotReachOutsideTheRoot
- **GIVEN** `bash` confined by MXC's real macOS executor, a file beside the root, an agent directory with a key, and a process of the server's user
- **WHEN** a command reads both files, writes in the root and beside it, and signals that process
- **THEN** both reads fail, only the write in the root lands, the signal is refused and the process lives, and no key is in the command's environment

#### Scenario: OnMacOsGitAnswersQuietly
- **GIVEN** `bash` confined by MXC's real macOS executor in a git repository that is its writable root
- **WHEN** a command runs `git status`
- **THEN** git answers, prints no warning about temporary or cache directories, and leaves no new file in the root

#### Scenario: OnMacOsWithoutAnAllowlistTheNetworkIsOpen
- **GIVEN** `bash` confined by MXC on macOS and no `sandbox.allowedHosts`
- **WHEN** a command fetches a public host
- **THEN** it is reached

### Requirement: OnMacOsTheNetworkFollowsAllowedHosts

Under MXC on macOS, the agent's shell SHALL keep an open network without `sandbox.allowedHosts`, and with
it SHALL reach only the listed hosts through the server's proxy, with outbound and inbound traffic denied.

#### Scenario: OnMacOsAnAllowedHostIsReachedAndOthersAreRefused
- **GIVEN** `sandbox.allowedHosts` naming `registry.npmjs.org`, and `bash` confined by MXC's real macOS executor
- **WHEN** a command fetches that host, an unlisted host, and that host again ignoring the proxy, and reaches another service on the loopback
- **THEN** only the first succeeds, through the proxy, and the output ends with the note naming the unlisted host
