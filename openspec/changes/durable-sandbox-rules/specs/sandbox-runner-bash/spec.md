# Spec Delta

## MODIFIED Requirements

### Requirement: MxcComesWithPiOutpost

MXC's SDK (`@microsoft/mxc-sdk`) SHALL be an optional dependency of pi-outpost, and the value `"mxc"` in
`sandbox.bashRunner` or `terminal.sandbox` SHALL name MXC run in process through it, as Microsoft
recommends: no executor of MXC's (`wxc-exec.exe`, `lxc-exec`, `mxc-exec-mac`) SHALL run for the agent's
shell, its diagnosis or the self-check. The one exception is the confined terminal on Windows
(`OnWindows11MxcMayConfineTheTerminal`). A path whose file
is one of those executors SHALL be read as `"mxc"`, and the startup line SHALL say so. When the SDK cannot
be loaded on this machine the configuration SHALL be refused at load, naming what to install.

#### Scenario: MxcNamesTheBundledExecutor
- **GIVEN** pi-outpost installed with its optional dependencies
- **WHEN** the configuration names `"mxc"` as `sandbox.bashRunner` and as `terminal.sandbox`
- **THEN** both run MXC in process through the SDK, no executor process is started, and a path such as `./mxc` stays a path

#### Scenario: AStandaloneExecutableFindsTheExecutorBesideIt
- **GIVEN** a standalone executable, with no `node_modules`
- **WHEN** `build-exe` produces it where MXC's SDK is installed, and `"mxc"` is resolved by it
- **THEN** MXC's native parts are placed beside the executable (existing ones kept unless `--force`), and `"mxc"` runs MXC in process from them, with no `wxc-exec.exe`

#### Scenario: AnExecutorPathIsReadAsMxc
- **GIVEN** a configuration written before, naming `C:\mxc\wxc-exec.exe` as `sandbox.bashRunner`
- **WHEN** the server starts
- **THEN** it runs MXC through the SDK, and its startup line says the executor's path was read as `"mxc"`

### Requirement: OnLinuxMxcMayConfineBash

On Linux, `"mxc"` SHALL run MXC's Bubblewrap backend in process through the SDK, and a path whose file is
`lxc-exec` SHALL name MXC too. Its commands SHALL run with the same limits as a confined command
elsewhere: the root writable or read-only, the agent directory and the configuration denied, the minimal
environment for the command, and none of the server's processes visible.

#### Scenario: MxcNamesTheLinuxExecutor
- **GIVEN** a Linux host with `@microsoft/mxc-sdk` installed
- **WHEN** the configuration names `"mxc"` as `sandbox.bashRunner`, or a path ending in `lxc-exec`
- **THEN** it is treated as MXC, and commands run in its Bubblewrap backend through the SDK

#### Scenario: OnLinuxACommandCannotReadOutsideTheRoot
- **GIVEN** `bash` confined by MXC on Linux in a container that allows it, a file beside the root and an agent directory with a key
- **WHEN** a command reads both, writes in the root and beside it, lists the processes it sees, and runs git
- **THEN** both reads fail, only the write in the root lands, no server process and no key is visible, and git answers

### Requirement: OnMacOsMxcMayConfineBash

On macOS on Apple silicon, `"mxc"` SHALL run MXC's Seatbelt backend in process through the SDK, and a
path whose file is `mxc-exec-mac` SHALL name MXC too. Its commands SHALL run with the limits of a confined
command elsewhere, and SHALL signal no process outside the command.

#### Scenario: MxcNamesTheMacOsExecutor
- **GIVEN** a Mac on Apple silicon with `@microsoft/mxc-sdk` installed
- **WHEN** the configuration names `"mxc"` as `sandbox.bashRunner`, or a path ending in `mxc-exec-mac`
- **THEN** it is treated as MXC, and commands run under Seatbelt through the SDK

#### Scenario: OnAnIntelMacMxcIsRefused
- **GIVEN** a Mac on an Intel processor
- **WHEN** the configuration names `"mxc"` as `sandbox.bashRunner`
- **THEN** loading the configuration fails, saying MXC does not run on this architecture

#### Scenario: OnMacOsACommandCannotReachOutsideTheRoot
- **GIVEN** `bash` confined by MXC on macOS, a file beside the root, an agent directory with a key, and a process of the server's user
- **WHEN** a command reads both files, writes in the root and beside it, and signals that process
- **THEN** both reads fail, only the write in the root lands, the signal is refused and the process lives, and no key is in the command's environment

#### Scenario: OnMacOsGitAnswersQuietly
- **GIVEN** `bash` confined by MXC on macOS in a git repository that is its writable root
- **WHEN** a command runs `git status`
- **THEN** git answers, prints no warning about temporary or cache directories, and leaves no new file in the root

#### Scenario: OnMacOsWithoutAnAllowlistTheNetworkIsOpen
- **GIVEN** `bash` confined by MXC on macOS and no `sandbox.allowedHosts`
- **WHEN** a command fetches a public host
- **THEN** it is reached
