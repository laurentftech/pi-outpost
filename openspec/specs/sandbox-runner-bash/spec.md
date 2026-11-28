# sandbox-runner-bash Specification

## Purpose
Confines the agent's own shell without handing it to an extension: every command pi-outpost's `bash`
runs goes through a sandbox runner named in the configuration, with the policy of a confined terminal,
so a deployment — on Windows 11 with MXC, on Linux with landstrip — can let the agent run commands that
stay inside its project and never see the server's keys.

## Requirements

### Requirement: TheSandboxMayNameARunnerForBash

The configuration's `sandbox` MAY declare `bashRunner`, the path of a sandbox runner (resolved against
the configuration file), and `bashShell`, the shell its commands run in. `bashRunner` SHALL apply only
while `allowBash` is on. Declaring both `bashRunner` and `bashFrom` SHALL be refused when the
configuration loads. The values `"auto"` and `"none"` SHALL NOT be resolved as paths: `"auto"` asks
the server to choose a runner (see `sandbox-defaults`), and `"none"` runs the shell unconfined.

#### Scenario: BashRunnerAndBashFromAreExclusive
- **WHEN** the configuration declares `sandbox.bashRunner` and `sandbox.bashFrom` together
- **THEN** it is refused, naming both settings

#### Scenario: TheRunnerPathIsResolved
- **WHEN** the configuration declares a relative `sandbox.bashRunner` and `sandbox.bashShell`
- **THEN** both load as absolute paths, resolved against the configuration file's directory

#### Scenario: AutoAndNoneAreNotPaths
- **WHEN** the configuration declares `sandbox.bashRunner` as `"auto"`, then as `"none"`
- **THEN** each loads as that keyword, not as a path under the configuration file's directory

### Requirement: EveryBashCommandRunsInsideTheRunner

While `allowBash` is on and `bashRunner` is set, every command the agent runs with `bash` SHALL run
inside the runner, in `bashShell`, with the policy of a confined terminal in the same workspace: reading
limited to the sandbox root (and what the runner needs to run the shell), writing limited to the writable
zone and a private temporary directory, the agent directory and the configuration unreadable. The
command's output, exit status, timeout and cancellation SHALL behave as for an unconfined `bash`.

#### Scenario: ACommandCannotReadOutsideTheRoot
- **GIVEN** `bash` confined by a runner, in a workspace whose sandbox root is `app`
- **WHEN** the agent runs a command reading a sibling project's file, then the agent directory's `auth.json`
- **THEN** both reads are refused, and neither file's content reaches the agent

#### Scenario: ACommandWritesOnlyInTheWritableZone
- **GIVEN** `bash` confined by a runner, with sandbox root `app` and writable zone `app/out`
- **WHEN** the agent writes a file in `app/out`, then in `app`
- **THEN** the first file exists and the second write is refused

#### Scenario: OutputAndExitStatusComeBack
- **GIVEN** `bash` confined by a runner
- **WHEN** the agent runs a command that prints to standard output and to standard error, then exits with status 3
- **THEN** the agent receives both outputs and the command is reported as failed with status 3

#### Scenario: CancellingACommandEndsIt
- **GIVEN** `bash` confined by a runner, running a command that sleeps for a minute
- **WHEN** the call is aborted or its timeout expires
- **THEN** the call ends promptly and the confined command no longer runs

### Requirement: AConfinedCommandGetsAMinimalEnvironment

A command run by a confined `bash` SHALL receive the environment of a confined terminal — search path,
locale, terminal type, shell, a home inside the sandbox root, a private temporary directory and npm cache,
the user's git configuration (read-only, nothing beside it), and on Windows the system's locations — and SHALL NOT receive the server's other variables, provider keys
included.

#### Scenario: KeysDoNotReachTheAgentsCommands
- **GIVEN** the server started with `OPENAI_API_KEY` in its environment and `bash` confined by a runner
- **WHEN** the agent lists its command's environment
- **THEN** `OPENAI_API_KEY` is absent

#### Scenario: TheAgentsCommitsCarryTheUsersIdentity
- **GIVEN** a user whose git configuration names them and does not require signing, and `bash` confined by a runner
- **WHEN** the agent commits, then appends to that configuration, then asks npm for its cache
- **THEN** the commit's author is the user, the append is refused and the file unchanged, and npm's cache is in the command's private temporary directory

### Requirement: AnUnusableRunnerRefusesEveryCommand

When `bashRunner` is set but the runner is missing, fails its self-check, or (on Windows) no `bashShell`
is named, every `bash` call SHALL be refused with the reason, and no command SHALL run, confined or not.
The session SHALL start and its other tools SHALL keep working.

#### Scenario: AMissingRunnerRefusesTheCommand
- **GIVEN** `sandbox.bashRunner` pointing at a path that does not exist
- **WHEN** the agent calls `bash`
- **THEN** the call fails with a reason naming that path, and the command did not run

#### Scenario: AFailedSelfCheckRefusesTheCommand
- **GIVEN** `sandbox.bashRunner` pointing at a runner whose self-check fails
- **WHEN** the agent calls `bash`
- **THEN** the call fails with the runner's reason, and the command did not run

### Requirement: SettingsPreserveTheRunner

Applying sandbox settings from the browser SHALL keep `bashRunner` and `bashShell`, which Settings do not
edit.

#### Scenario: ApplyingSettingsKeepsTheRunner
- **GIVEN** `sandbox.bashRunner` and `sandbox.bashShell` in the configuration
- **WHEN** the browser applies a sandbox change (turning `allowWrite` off)
- **THEN** the running configuration still names the same runner and shell, and `bash` is still confined

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
when its last statement failed, the native program's exit code or 1; otherwise 0. Setting that status SHALL
NOT cut the command's output short: a command that does not exit itself gives back everything it printed.

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

#### Scenario: AFormattedObjectDoesNotCutTheOutputShort
- **GIVEN** the `powershell` tool confined by a runner, PowerShell 7 or Windows PowerShell 5.1
- **WHEN** the agent runs a command printing a line, then an object PowerShell formats as a table (`Get-Location`), then another line, and one doing the same and ending on a failed cmdlet
- **THEN** both lines and the table come back, in order, and the statuses are 0 and 1

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

Under `sandbox.allowedHosts`, a host the list does not name SHALL be refused, unless the user, asked while
the connection waits, allows it (see `sandbox-approved-grants`). Refused without anyone to ask, the
proxy's response SHALL name that host and `sandbox.allowedHosts`, the command's output SHALL end with a note
naming every host refused while it ran, and the server SHALL log the refusal. A direct connection, and any
other service on the host's loopback, SHALL be unreachable from a command.

#### Scenario: AnotherHostIsRefusedWithTheReason
- **GIVEN** `sandbox.allowedHosts`, the agent's shell confined by MXC, and no one to ask about a host
- **WHEN** a command fetches a host the list does not name
- **THEN** it fails, the command's output ends with a note naming that host and `sandbox.allowedHosts` — curl, git and Windows PowerShell print only the status code — the proxy's own answer names them too, and the server logs the refusal

#### Scenario: NoOneToAskKeepsTheListAlone
- **GIVEN** `sandbox.allowedHosts`, the agent's shell confined by MXC, and `sandbox.grants: "never"`
- **WHEN** a command fetches a host the list does not name
- **THEN** it is refused at once, nobody is asked, and the note ending its output asks for the host to be added to `sandbox.allowedHosts`

#### Scenario: TheProxyCannotBeBypassed
- **GIVEN** the same configuration
- **WHEN** a command connects to an address directly, ignoring the proxy, or reaches another service listening on the host's loopback
- **THEN** the connection is refused

### Requirement: AnAllowlistNeedsMxcWithoutAnImage

`sandbox.allowedHosts` SHALL be refused at load, with a reason naming the key and what it needs, unless
the `bashRunner` is MXC without a `bashImage`, Seatbelt, or landstrip on Linux: no other backend
enforces it here.

#### Scenario: AnAllowlistNeedsMxcWithoutAnImage
- **GIVEN** `sandbox.allowedHosts` with no runner, with landstrip as `bashRunner` on Windows, or with `bashImage`
- **WHEN** the configuration is loaded
- **THEN** it is refused with a reason naming the key and what it needs

#### Scenario: AnAllowlistIsKeptUnderLandstripOnLinux
- **GIVEN** `sandbox.allowedHosts` naming `Registry.npmjs.org`, and landstrip as `bashRunner` on Linux
- **WHEN** the configuration is loaded
- **THEN** it is kept, lower-cased, and the configuration loads

### Requirement: AConfinedShellRunsATurnsCommandsInOrder

When a `bashRunner` confines the agent's shell (`bash` or `powershell`), the commands the model asks
for in one message SHALL run one after another, in the order it wrote them, each starting only once
the previous one has ended.

#### Scenario: ATurnsCommandsRunInOrder
- **GIVEN** `bash` confined by a runner
- **WHEN** one message asks for two commands, the first writing a file after a delay and the second reading it
- **THEN** the second starts after the first has ended, and reads the file the first wrote

### Requirement: OnMacOsSeatbeltMayConfineBash

On macOS, on Apple silicon or Intel, `"seatbelt"` as `sandbox.bashRunner` SHALL name the system's
`/usr/bin/sandbox-exec`, and a path whose file is `sandbox-exec` SHALL name it too. Its commands SHALL
run under a Seatbelt profile pi-outpost writes from the configuration, with the limits of a confined
command elsewhere, and SHALL signal no process outside the command. Elsewhere than macOS the value
SHALL be refused.

#### Scenario: SeatbeltNamesTheSystemRunner
- **GIVEN** a Mac, Intel or Apple silicon
- **WHEN** the configuration names `"seatbelt"` as `sandbox.bashRunner`
- **THEN** it resolves to `/usr/bin/sandbox-exec`, and on Linux or Windows loading the configuration fails naming macOS

#### Scenario: UnderSeatbeltACommandCannotReachOutsideTheRoot
- **GIVEN** `bash` confined by the Seatbelt runner, a file beside the root, an agent directory with a key, and a process of the server's user
- **WHEN** a command reads both files, writes in the root and beside it, and signals that process
- **THEN** both reads fail, only the write in the root lands, the signal is refused and the process lives, and no key is in the command's environment

#### Scenario: UnderSeatbeltGitAnswersQuietly
- **GIVEN** `bash` confined by the Seatbelt runner in a git repository that is its writable root
- **WHEN** a command runs `git status`
- **THEN** git answers, prints no warning about temporary or cache directories, and leaves no new file in the root

### Requirement: UnderSeatbeltTheNetworkFollowsAllowedHosts

Under the Seatbelt runner, the agent's shell SHALL keep an open network, with the host's loopback
closed, without `sandbox.allowedHosts`; with it, it SHALL reach only the listed hosts through the
server's proxy.

#### Scenario: UnderSeatbeltWithoutAnAllowlistTheNetworkIsOpen
- **GIVEN** `bash` confined by the Seatbelt runner and no `sandbox.allowedHosts`
- **WHEN** a command fetches a public host and another service on the loopback
- **THEN** the public host is reached and the loopback service is not

#### Scenario: UnderSeatbeltAnAllowedHostIsReachedAndOthersAreRefused
- **GIVEN** `sandbox.allowedHosts` naming `registry.npmjs.org`, and `bash` confined by the Seatbelt runner
- **WHEN** a command fetches that host, an unlisted host, and that host again ignoring the proxy, and reaches another service on the loopback
- **THEN** only the first succeeds, through the proxy, and the output ends with the note naming the unlisted host

### Requirement: ConfinementIsVerifiedBeforeItIsShown

When `sandbox.bashRunner` is set and its self-check passes, the server SHALL run a canary through that
runner, with the agent shell's policy, attempting what confinement must refuse (see design). It SHALL run
again when the sandbox settings change; its verdict SHALL be sent to clients. An unconfined shell (`"none"`,
or `allowBash` without a runner in an explicit section) SHALL be shown with an open lock. An RPC child's
shell SHALL NOT be judged.

#### Scenario: AVerifiedRunnerEarnsTheLock
- **GIVEN** a configured runner that refuses every attempt of the canary
- **WHEN** the interface shows the agent's shell
- **THEN** a closed lock is shown, and its description names the runner, when it was checked, and each refusal

#### Scenario: ALeakOpensTheLockAndSaysWhat
- **GIVEN** a configured runner whose policy lets the canary read the agent directory
- **WHEN** the canary runs
- **THEN** the lock is shown open and marked as a failure, naming the agent directory as readable, and the configuration is left as it was

#### Scenario: NoRunnerNoLock
- **GIVEN** a runner but `allowBash` off, or bash handed to an extension (`bashFrom`)
- **WHEN** the interface shows the agent's shell
- **THEN** no lock is shown

#### Scenario: AnUnconfinedShellIsMarked
- **GIVEN** `allowBash` on and `bashRunner: "none"`, or `allowBash` on with no `bashRunner` in an explicit `sandbox` section
- **WHEN** the interface shows the agent's shell
- **THEN** an open lock is shown, and its description says that the shell is not confined

#### Scenario: AnRpcChildsShellIsNotJudged
- **GIVEN** the `rpc` agent runtime
- **WHEN** the interface shows the agent's shell
- **THEN** no lock is shown

### Requirement: DoctorRunsTheCanary

`pi-outpost doctor` SHALL run the canary for each runner the configuration names and report, per
attempt, whether it was refused; any attempt that succeeded SHALL be a failed check.

#### Scenario: DoctorReportsWhatGotThrough
- **GIVEN** a configuration whose runner lets a write beside the root succeed
- **WHEN** `pi-outpost doctor` runs
- **THEN** its report holds a failed check naming the write beside the root, and its exit status is non-zero

### Requirement: AReadableServerEnvironmentIsJudgedByWhatItHolds

When the only attempt that got through is reading the server's process environment (as under
landstrip before 0.20 on Linux; 0.20 hides the server's process), the verdict SHALL depend on what
that environment holds: with no secret-looking variable, the lock SHALL be shown closed and say the
environment is readable but holds no secret; with some, it SHALL be shown partly confined, naming
those variables and never their values.

#### Scenario: AReadableEnvironmentWithoutSecretsKeepsTheLock
- **GIVEN** a runner under which a command can read the server's process environment, and a server environment with no key, token, secret or password
- **WHEN** the canary runs
- **THEN** the lock is closed, and its description says the server's environment is readable and holds no secret

#### Scenario: SecretsInAReadableEnvironmentAreNamed
- **GIVEN** the same runner, and a server started with `OPENAI_API_KEY` in its environment
- **WHEN** the canary runs
- **THEN** the lock is shown partly confined, naming `OPENAI_API_KEY` and not its value, and `doctor` reports it as a warning

### Requirement: UnderMxcOnWindowsTheSearchPathIsReadable

Under MXC on Windows, a confined command SHALL be able to read every absolute folder its `PATH` names,
so that a program found on `PATH` runs, even inside the user's denied profile. A folder that is or holds
the home directory, holds the agent directory or the configuration file, or is a drive's root SHALL NOT
be made readable by this, and the agent directory and the configuration file SHALL stay denied.

#### Scenario: AToolInstalledForTheUserRuns
- **GIVEN** the agent's shell confined by MXC on Windows, and Python installed for the user under `AppData\Local\Programs`, its folder on `PATH`
- **WHEN** a command runs `python --version` and a line of Python
- **THEN** both run, while the agent directory's keys file is still refused and the profile's other folders stay out of reach

### Requirement: ABareShellIsFoundOnThePath

A `sandbox.bashShell` given as a bare name SHALL be looked up on `PATH` when the configuration loads,
with `PATHEXT` on Windows, and SHALL run from what is found there. One not on `PATH` SHALL stop startup
with a message naming it. A path SHALL be resolved against the configuration's folder, as before.

#### Scenario: ABareShellNameIsFoundOnThePath
- **GIVEN** `sandbox.bashShell: "pwsh.exe"` and PowerShell 7 on `PATH`
- **WHEN** the configuration loads, and the agent's shell runs under MXC
- **THEN** the shell is PowerShell 7 from `PATH`, and the canary finds it confined; a name not on `PATH` stops startup saying so

### Requirement: UnderLandstripOnLinuxTheNetworkFollowsAllowedHosts

Under landstrip on Linux, the agent's shell SHALL keep the network it has today without
`sandbox.allowedHosts`. With it, the shell SHALL reach only the listed hosts, through the server's proxy.
Direct IP traffic SHALL be denied, and so SHALL every loopback port but its proxy's, whatever loopback
address it is reached on.

#### Scenario: UnderLandstripWithoutAnAllowlistTheNetworkIsOpen
- **GIVEN** `bash` confined by the real landstrip runner on Linux and no `sandbox.allowedHosts`
- **WHEN** a command fetches a public host
- **THEN** the host is reached and no proxy variable is set in the command's environment

#### Scenario: UnderLandstripAnAllowedHostIsReachedAndOthersAreRefused
- **GIVEN** `sandbox.allowedHosts` naming `registry.npmjs.org`, and `bash` confined by the real landstrip runner on Linux
- **WHEN** a command fetches that host, an unlisted host, and that host again ignoring the proxy, and reaches another service on the loopback
- **THEN** only the first succeeds, through the proxy, and the output ends with the note naming the unlisted host

#### Scenario: UnderLandstripNoOtherLoopbackAddressReachesAService
- **GIVEN** the same shell, and a service listening on the host's loopback on a port other than the proxy's
- **WHEN** a command connects to that service at `127.0.0.1`, at another `127.x` address and at `::1`, and opens a listening socket
- **THEN** every connection fails without the service's answer, and the listening socket is refused

### Requirement: ALandstripRefusalIsToldInWords

Under landstrip, each refusal landstrip reports on stderr SHALL reach the agent as one line naming
the operation and its target, saying the sandbox refused it and that the command went on, instead of
landstrip's JSON. Every other line of the command's output SHALL pass unchanged.

#### Scenario: ALandstripRefusalIsToldInWords
- **GIVEN** `bash` confined by the real landstrip runner on Linux
- **WHEN** a command makes a `bind` the sandbox refuses and survives it, and writes beside the root
- **THEN** its output holds `[sandbox] refused bind [::1]:0` and `[sandbox] refused write <path>`, no landstrip JSON, and its exit status is the command's own

### Requirement: TheStartupLineSaysAnEmptyListAsks

The server's startup line SHALL describe the agent's network as it behaves. With
`sandbox.allowedHosts` empty, it SHALL say every host is asked about under host questions, and that
the network is closed without them. With hosts listed, it SHALL name those hosts, and say the others
are asked about when they are.

#### Scenario: TheStartupLineSaysAnEmptyListAsks
- **GIVEN** `sandbox.allowedHosts: []` under a runner that takes host questions
- **WHEN** the server starts
- **THEN** the sandbox line says every host is asked about, and with `sandbox.grants: "never"` it says the network is closed

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
output shows a refused connection, the note SHALL say so without a host, and SHALL NOT claim the
Internet is open. A refused connection SHALL NOT offer a file diagnosis.

#### Scenario: ASandboxRefusalIsNamed
- **GIVEN** the agent's PowerShell confined by MXC on Windows 11 tier 1, the private network closed by default
- **WHEN** a command connects to another address of the machine's private subnet, with .NET's own error, and with curl, which prints only that it could not connect
- **THEN** each output ends with the note naming that address and `sandbox.privateNetwork`, and offers no diagnosis; a command that met no refusal gets none

#### Scenario: TheNoHostRefusalNoteDoesNotClaimTheInternetIsOpen
- **GIVEN** the agent's PowerShell confined by MXC on Windows 11 tier 1 without `sandbox.allowedHosts`, on a machine with no route to the Internet (air-gapped) whose own firewall answers WSAEACCES (10013)
- **WHEN** a command's output shows the refused-connection error and names no host the sandbox's policy refuses
- **THEN** the ending note says a connection was refused (WSAEACCES, 10013) without naming the sandbox as the refuser and without claiming the Internet is open — on an air-gapped machine the same error comes from the machine's own firewall; it states that the sandbox does not restrict outbound connections without `sandbox.allowedHosts` (whether the Internet answers is the machine's network, not the sandbox's) and which addresses it does close (the private network unless `sandbox.privateNetwork` is true, the machine's own services when `sandbox.hostLoopback` is false), and says retrying will not help

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

### Requirement: AToolOnAnotherDriveThanTheRootsResolves

Under MXC on Windows, when a folder a command opens by path is on another drive than the project root's,
the root of that drive and every folder above the opened one SHALL be readable, not merely enumerable, so
a command can traverse them; the opened folder and a junction's target SHALL be readable as on the root's
drive; and everything beside the way down on that drive SHALL keep its contents denied.

#### Scenario: AToolOnAnotherDriveThanTheRootsResolves
- **GIVEN** the project root on `C:\Users\me\work\app`, scoop on a second drive `D:\WRK\Scoop`, `D:\WRK\Scoop\apps\nodejs\current` a junction to `D:\WRK\Scoop\apps\nodejs\v26.8.2` whose root holds `node.exe`, and `PATH` naming `current\bin`, `current` and `D:\WRK\Scoop\shims`, all confined by MXC on Windows 11 tier 1
- **WHEN** a command runs `Get-Command node; node -v`
- **THEN** `node` resolves through the junction to `current\node.exe` and runs — `D:\`, `D:\WRK`, `D:\WRK\Scoop`, `D:\WRK\Scoop\apps`, `D:\WRK\Scoop\apps\nodejs`, the junction and its target are readable, the link is never enumerated, and `D:\private` or `Scoop\buckets` keep their contents denied

### Requirement: BesideTheForeignWayDownStaysDenied

Under MXC on Windows, on a drive other than the project root's, everything beside the readable way
down to an opened folder SHALL be denied by name in each folder of the way down, as beside the
root on the root's drive — the system temporary directory included.

#### Scenario: BesideTheForeignWayDownStaysDenied
- **GIVEN** the project root on `D:\projects\app`, a tool on `PATH` under the profile on
  `C:\Users\me\AppData\Local\Python\3.11.4`, the system temporary directory
  `C:\Users\me\AppData\Local\Temp`, and PowerShell confined by MXC on Windows 11 tier 1
- **WHEN** the confinement canary runs, its beside-root bait in a fresh directory under the
  system temporary directory
- **THEN** reading the bait's marker and writing beside it are both refused and the verdict is
  `verified` (not `leaking`); in the policy the way down on `C:` (`C:\`, `C:\Users`,
  `…\AppData`, `…\AppData\Local`, the tool) is in `readonlyPaths` and not in `deniedPaths`, while
  `C:\Users\me\AppData\Local\Temp` is in `deniedPaths`; the command's own `pi-outpost-bash-*`
  folder stays in `readwritePaths` (the more specific allow wins over the deny), and the system
  folders at `C:\` stay readable

### Requirement: ForeignWayDownDeniedWithoutEnumeration

Under MXC on Windows, on a drive other than the project root's, the way down to every opened
folder (the shell's, the search path's tools', the grants') SHALL be computed whatever the
enumeration level the host proved (0, 1, or 2 — none), and everything beside that way down SHALL
be denied by name at every level, exactly as at full enumeration — the system temporary
directory included.

#### Scenario: ForeignWayDownDeniedWithoutEnumeration
- **GIVEN** the project root on `D:\projects\app`, a tool on `PATH` under the profile on
  `C:\Users\me\AppData\Local\Python\3.11.4`, a read grant (the sandbox cache) at
  `C:\Users\me\AppData\Local\pi-outpost\sandbox-cache`, the system temporary directory
  `C:\Users\me\AppData\Local\Temp`, and a host whose MXC cannot build a policy with listable
  folders (enumeration level 2), so commands run with no `enumeratePaths` at all
- **WHEN** the policy is built for a command of the confined shell on Windows MXC
- **THEN** `C:\` and the way down on it (`C:\Users`, `…\AppData`, `…\AppData\Local`, the tool's
  folders, the cache's folders) are in `readonlyPaths` and not in `deniedPaths`, while
  `C:\Users\me\AppData\Local\Temp` and `…\AppData\Roaming` are in `deniedPaths` — at level 2 as
  at levels 0 and 1 — the command's own `pi-outpost-bash-*` folder under `Temp` stays in
  `readwritePaths` and not denied (the more specific allow wins), system folders at `C:\` stay
  readable, and `enumeratePaths` is empty at level 2; the confinement canary's beside-root bait
  in a fresh directory under `%TEMP%` is refused, so the verdict is `verified`, not `leaking`
  (issue #585)

### Requirement: StrictDeniesKeepOnlyOpenableEntries

Under MXC on Windows, when the host's process security environment refuses the policy over a denied
path it cannot open (`0x80070005`), the deny list SHALL be pruned — as the last fallback after the
enumeration levels — to the entries the host can open there, and capped well under the security
environment's size budget (measured 556 denied pass, 557 refuse the launch) with the entries that
carry the confinement first: the root's-drive siblings, the agent directory, the configuration file,
then the temporary directory's parent. Openable folders (the system temporary directory included)
SHALL stay denied by name.

#### Scenario: StrictDeniesKeepOnlyOpenableEntries
- **GIVEN** a Windows host joined to a domain, where building the process security environment over
  a denied file under the profile fails with `0x80070005`, the project root on `D:\projects\app`,
  and a denied entry that the host cannot open at all alongside the temporary directory
  `C:\Users\me\AppData\Local\Temp`
- **WHEN** a command of the confined shell is launched and the policy is refused at every enumeration
  level, then rebuilt in strict mode
- **THEN** the unopenable denied entry is absent from `deniedPaths`, the openable temporary directory
  is still present in `deniedPaths`, the launch succeeds confined, and the canary's beside-root bait
  in a fresh directory under `%TEMP%` is refused — the verdict is `verified`, not `leaking`, and the
  shell is not reported unavailable. On a foreign drive the way down SHALL also stay readable on top
  of the drive's root in strict mode: a path resolved through a denied folder fails (#553), which
  would break the shell's own scripts (observed: the canary's verdict never printed after the
  read-only pruning)
