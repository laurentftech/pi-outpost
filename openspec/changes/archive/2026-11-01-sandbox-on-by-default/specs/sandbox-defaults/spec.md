# Spec Delta

## Purpose

Gives every installation a sandbox it did not have to write: file tools scoped to the project and a shell
confined by whatever runner this machine supports, refused rather than unconfined when none does. It keeps
an explicit way back to an unconfined shell, and nudges unconfined installations toward confinement once
their machine can provide it.

## ADDED Requirements

### Requirement: AnUndescribedSandboxGetsTheDefault

When the configuration has no `sandbox` section and the agent runtime is not `rpc`, the server SHALL run
with a sandbox rooted at the working directory, with writing allowed inside it, and with `allowBash` on
and `bashRunner` set to `"auto"`.

#### Scenario: NoSandboxSectionGetsTheDefault
- **GIVEN** a configuration without a `sandbox` section
- **WHEN** the server starts in a project directory
- **THEN** the agent's file tools are confined to that directory, its writes succeed inside it and are refused outside it, and its shell's runner is chosen automatically

#### Scenario: RpcModeGetsNoDefault
- **GIVEN** a configuration selecting the `rpc` agent runtime and no `sandbox` section
- **WHEN** the configuration loads
- **THEN** it loads without a sandbox and without the refusal reserved for a sandbox combined with `rpc`

### Requirement: TheDefaultSandboxMayBeTurnedOff

`"sandbox": false` in the configuration file SHALL restore the unsandboxed behaviour: unscoped file tools,
and a shell that is not confined.

#### Scenario: SandboxFalseRestoresTheOldBehaviour
- **GIVEN** `"sandbox": false` in the configuration
- **WHEN** the agent writes a file outside the working directory
- **THEN** the write succeeds, and no lock is shown for the shell

### Requirement: AutoChoosesARunnerThatProvedItConfines

`bashRunner: "auto"` SHALL take the platform's candidate runner (MXC's executor on Windows and Linux,
Seatbelt on macOS) only after its self-check and the confinement canary pass. On Windows, a missing
`bashShell` SHALL mean PowerShell.

#### Scenario: AutoOnACapableWindowsBuild
- **GIVEN** Windows 11 26100.9278 or later with MXC's executor installed, and `bashRunner: "auto"` without `bashShell`
- **WHEN** the agent runs its first command
- **THEN** the command runs under MXC, in PowerShell, through the `powershell` tool, and the lock is shown closed

#### Scenario: AutoOnMacOs
- **GIVEN** macOS and `bashRunner: "auto"`
- **WHEN** the agent runs a command
- **THEN** it runs under Seatbelt

### Requirement: AutoFailsClosed

When no candidate passes, every shell command SHALL be refused with the reason, no command SHALL run
confined or not, and the session's other tools SHALL keep working.

#### Scenario: AnOldWindowsBuildRefusesTheShell
- **GIVEN** Windows 11 26100 at a build below 9278, and `bashRunner: "auto"`
- **WHEN** the agent calls its shell tool
- **THEN** the call fails with a reason naming the installed build and the Windows update it needs, and the command did not run

#### Scenario: ACanaryLeakRefusesTheShell
- **GIVEN** `bashRunner: "auto"` and a runner whose self-check passes but whose canary reads the agent directory
- **WHEN** the agent calls its shell tool
- **THEN** the call fails, naming what the canary reached, and the command did not run

#### Scenario: TheInterfaceShowsWhyTheShellIsUnavailable
- **GIVEN** `bashRunner: "auto"` and no candidate that passes
- **WHEN** the interface shows the agent's shell
- **THEN** it shows the shell as unavailable, with the same reason the tool gives

### Requirement: ChoosingTheRunnerDoesNotDelayTheSession

Choosing an `"auto"` runner SHALL happen in the background. The session SHALL start and accept prompts
before the choice completes. A command issued before then SHALL wait for the choice, then run or be refused.

#### Scenario: APromptBeforeTheChoiceIsAnswered
- **GIVEN** `bashRunner: "auto"` and a runner whose canary takes several seconds
- **WHEN** the user sends a prompt as soon as the session opens
- **THEN** the prompt is accepted at once, and a shell command it issues runs only after the canary has passed

#### Scenario: TheInterfaceShowsTheChoiceInProgress
- **GIVEN** `bashRunner: "auto"` while the choice is pending
- **WHEN** the interface shows the agent's shell
- **THEN** it shows the choice as in progress, not as confined

### Requirement: NoneRunsTheShellUnconfined

`bashRunner: "none"` SHALL run the shell unconfined in the sandbox root. It SHALL be accepted from the
configuration file only, and the interface SHALL show the shell's lock open.

#### Scenario: NoneUnlocksTheShellOnAnOldBuild
- **GIVEN** Windows 11 below the supported build, `allowBash` on, and `bashRunner: "none"` with a `bashShell`
- **WHEN** the agent runs a command
- **THEN** the command runs, unconfined, and the shell's lock is shown open

#### Scenario: SettingsCannotSelectNone
- **GIVEN** a sandbox with `bashRunner: "auto"`
- **WHEN** a Settings update from the browser tries to set the runner to `"none"`
- **THEN** the update is refused, and the runner stays `"auto"`

### Requirement: AnExistingSandboxKeepsItsShell

A `sandbox` section with `allowBash` on and no `bashRunner` SHALL keep running the shell unconfined, as
`"none"`. A section that omits `allowBash` SHALL still leave it off.

#### Scenario: LegacyAllowBashStaysUnconfined
- **GIVEN** a configuration written before this change, with `"sandbox": { "allowBash": true }` and no `bashRunner`
- **WHEN** the agent runs a command
- **THEN** it runs unconfined, exactly as before

### Requirement: AnUnconfinedShellIsNudgedTowardConfinement

When the shell runs unconfined (`"none"` or the legacy spelling), the shell's lock SHALL be shown open. When
the platform's runner passes its self-check, the lock SHALL be highlighted and SHALL name that runner and
`"bashRunner": "auto"`, and the startup log and `pi-outpost doctor` SHALL say the same.

#### Scenario: ACapableMachineIsNudged
- **GIVEN** Windows 11 at 26100.9278 or later, MXC installed, and `"sandbox": { "allowBash": true }` without a runner
- **WHEN** the server starts and the interface opens
- **THEN** the shell's lock is open and highlighted, its description names MXC and `"bashRunner": "auto"`, and the startup log and `pi-outpost doctor` give the same suggestion

#### Scenario: TheSuggestionNamesTheCommand
- **GIVEN** an unconfined shell on a machine whose runner passes its self-check
- **WHEN** the lock's description, the startup log and `pi-outpost doctor` give their suggestion
- **THEN** each names `pi-outpost config --confine`

#### Scenario: AnIncapableMachineIsNotNudged
- **GIVEN** a Windows build below the supported one, and `bashRunner: "none"`
- **WHEN** the server starts and the interface opens
- **THEN** the shell's lock is open and neutral, its description gives the runner's reason, and no suggestion to confine the shell appears in the lock, the startup log or `doctor`

### Requirement: ConfineCommandWritesAVerifiedRunner

`pi-outpost config --confine` SHALL run the platform runner's self-check and canary with the configuration's
sandbox. Only if both pass SHALL it set `sandbox.bashRunner` to `"auto"` in the configuration file it
resolves, leaving every other key and their order unchanged, and print the change.

#### Scenario: ConfineOnACapableMachine
- **GIVEN** a configuration file with `"sandbox": { "allowBash": true }` and no runner, on a machine whose runner passes the self-check and the canary
- **WHEN** the user runs `pi-outpost config --confine`
- **THEN** the file now holds `"bashRunner": "auto"` in its `sandbox` section, its other keys and their order are unchanged, the change is printed, and the exit status is 0

#### Scenario: ConfineRefusesOnAnIncapableMachine
- **GIVEN** an unconfined shell on a Windows build below the supported one
- **WHEN** the user runs `pi-outpost config --confine`
- **THEN** the file is byte-for-byte unchanged, the self-check's reason is printed, and the exit status is non-zero

#### Scenario: ConfineRefusesWhenTheCanaryLeaks
- **GIVEN** a runner whose self-check passes but whose canary reaches the agent directory
- **WHEN** the user runs `pi-outpost config --confine`
- **THEN** the file is unchanged, what the canary reached is printed, and the exit status is non-zero

### Requirement: ConfineCommandChangesNothingElse

`pi-outpost config --confine` SHALL only confine a shell that is on and unconfined. It SHALL write nothing,
and SHALL say why, when the shell is already confined or off, when the sandbox is `false`, or when there is
no configuration file.

#### Scenario: AlreadyConfinedIsANoOp
- **GIVEN** a configuration whose `sandbox.bashRunner` is `"auto"`, `"mxc"` or a path
- **WHEN** the user runs `pi-outpost config --confine`
- **THEN** the file is unchanged, the output says the shell is already confined by that runner, and the exit status is 0

#### Scenario: NoShellNothingToConfine
- **GIVEN** a `sandbox` section without `allowBash`, or with `bashFrom`
- **WHEN** the user runs `pi-outpost config --confine`
- **THEN** the file is unchanged, and the output says that pi-outpost's own shell is not in use

#### Scenario: SandboxFalseIsNotOverridden
- **GIVEN** `"sandbox": false` in the configuration file
- **WHEN** the user runs `pi-outpost config --confine`
- **THEN** the file is unchanged, and the output says the sandbox is turned off and must be turned back on by hand, since that would also scope the file tools

#### Scenario: NoFileUsesTheDefault
- **GIVEN** no configuration file
- **WHEN** the user runs `pi-outpost config --confine`
- **THEN** no file is created, and the output says the default sandbox already chooses a runner automatically

### Requirement: TheAgentCannotWriteItsConfiguration

None of the agent's tools that write (`edit`, `write`, the document tools) SHALL write the server's
configuration file, whatever the writable zone and however its path is spelled. The file browser, the
user's own hand, is not held to this.

#### Scenario: AWriteToTheConfigurationIsRefused
- **GIVEN** the default sandbox, and the configuration file inside the project
- **WHEN** the agent writes or edits that file, by a relative, absolute or differently cased path, or names it as a document tool's destination
- **THEN** the call fails saying it is pi-outpost's configuration, and the file is unchanged, while other files of the project stay writable

### Requirement: InitWritesTheDefault

`pi-outpost init` SHALL write the default sandbox out explicitly: writing on, `allowBash` on, and
`"bashRunner": "auto"`.

#### Scenario: AStarterConfigurationIsTheDefault
- **WHEN** the user runs `pi-outpost init`
- **THEN** the file's `sandbox` holds `allowWrite: true`, `allowBash: true` and `"bashRunner": "auto"`
