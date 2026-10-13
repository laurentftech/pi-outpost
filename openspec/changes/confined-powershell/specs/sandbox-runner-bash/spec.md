## ADDED Requirements

### Requirement: PowerShellMayBeTheConfinedShell

When `bashRunner` is set and `bashShell` names PowerShell (`powershell.exe`, `pwsh.exe` or `pwsh`), the
agent SHALL be given pi's `powershell` tool instead of `bash`, and every command it runs SHALL run
inside the runner, in that shell, with the policy, environment and refusals of a confined `bash`.

#### Scenario: ThePowerShellToolReplacesBash
- **GIVEN** `allowBash`, a `bashRunner`, and `bashShell` naming `powershell.exe`
- **WHEN** the session's tools are built
- **THEN** the agent has a `powershell` tool and no `bash` tool, and no unconfined shell is registered

#### Scenario: APowerShellCommandRunsInsideTheRunner
- **GIVEN** the `powershell` tool confined by a runner
- **WHEN** the agent runs a command
- **THEN** the runner starts PowerShell with `-NoProfile -NonInteractive -ExecutionPolicy Bypass -File` on a script holding the command, written UTF-8 with a byte-order mark, under the policy a confined `bash` gets

### Requirement: AConfinedPowerShellCommandRunsAsAScript

A confined PowerShell command SHALL run from a script file written UTF-8 with a byte-order mark, in a
PowerShell started without profile, non-interactive, with the execution policy given for the process,
progress display off and output in UTF-8, as plain text. Its exit status SHALL be the one set with `exit`; otherwise,
when its last statement failed, the native program's exit code or 1; otherwise 0.

#### Scenario: PowerShellExitStatusComesBack
- **GIVEN** the `powershell` tool confined by a runner
- **WHEN** the agent runs a command ending in `exit 3`, one whose last native program fails with 5, one whose last cmdlet fails, and one that succeeds
- **THEN** the statuses reported are 3, 5, 1 and 0, and both outputs come back

#### Scenario: PowerShellOutputIsUtf8AndProgressIsOff
- **GIVEN** the `powershell` tool confined by a runner
- **WHEN** the agent runs a command printing non-ASCII text and reading `$ProgressPreference`
- **THEN** the text comes back intact and the preference is `SilentlyContinue`

#### Scenario: PowerShellOutputCarriesNoEscapeCodes
- **GIVEN** the `powershell` tool confined by a runner, PowerShell 7 or Windows PowerShell 5.1
- **WHEN** the agent runs a command printing a table and failing a cmdlet
- **THEN** the table and the error come back as plain text, with no terminal escape sequence

### Requirement: MxcComesWithPiOutpost

MXC's executor SHALL be an optional dependency of pi-outpost, and the value `"mxc"` in
`sandbox.bashRunner` or `terminal.sandbox` SHALL name it: the installed package's `wxc-exec.exe` for the
machine's architecture, else the `wxc-exec.exe` beside the running executable. When neither exists the
configuration SHALL be refused at load, naming what to install. Building a standalone executable on
Windows SHALL place the installed executor beside it.

#### Scenario: MxcNamesTheBundledExecutor
- **GIVEN** pi-outpost installed with its optional dependencies
- **WHEN** the configuration names `"mxc"` as `sandbox.bashRunner` and as `terminal.sandbox`
- **THEN** both resolve to the installed `@microsoft/mxc-sdk` executor for this architecture, while a path such as `./mxc` stays a path

#### Scenario: AStandaloneExecutableFindsTheExecutorBesideIt
- **GIVEN** a standalone executable, with no `node_modules`
- **WHEN** `build-exe` produces it on Windows, and `"mxc"` is resolved by it
- **THEN** `wxc-exec.exe` is copied beside the executable (an existing one kept unless `--force`), and `"mxc"` resolves to that file

### Requirement: BashMayRunInAWslcContainer

With MXC as `bashRunner`, `sandbox.bashImage` SHALL run every command of the agent's `bash` in a Linux
container of that image through MXC's WSLC backend: a container per command, under a name of its own,
with only the root (read-only, or writable with `allowWrite`) and the command's temporary folder mounted,
the container's own environment, and one image store shared by every command. Commands SHALL run one at
a time. A writable zone narrower than the root SHALL refuse the command rather than run it with more or
less than configured.

#### Scenario: ABashImageNeedsMxcAndNoShell
- **GIVEN** a configuration with `sandbox.bashImage`
- **WHEN** it is loaded with MXC as `bashRunner`, with no runner, with landstrip, or beside a `bashShell`
- **THEN** only the first is accepted, and the others are refused naming `sandbox.bashImage`

#### Scenario: AWslcCommandRunsInTheImage
- **GIVEN** `bash` confined by MXC with a `bashImage` and `allowWrite`
- **WHEN** the agent runs a command
- **THEN** MXC is asked for a `wslc` container of that image running `/bin/bash` on the script at its `/mnt/<drive>/` path, with the root and the temporary folder mounted writable, a container name of its own, a shared image store, and none of the server's environment

#### Scenario: AWritableZoneInsideTheRootIsRefusedUnderWslc
- **GIVEN** `bash` confined by MXC with a `bashImage`, and a `writableRoot` inside the root
- **WHEN** the agent runs a command
- **THEN** the command is refused with a reason naming `writableRoot`, and nothing is run

#### Scenario: WslcRunsOneAtATime
- **GIVEN** `bash` confined by MXC with a `bashImage`
- **WHEN** a turn runs several commands in parallel, one of which fails
- **THEN** they run one after another, never overlapping, and the failure does not prevent the next
