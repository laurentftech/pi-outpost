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
progress display off and output in UTF-8. Its exit status SHALL be the one set with `exit`; otherwise,
when its last statement failed, the native program's exit code or 1; otherwise 0.

#### Scenario: PowerShellExitStatusComesBack
- **GIVEN** the `powershell` tool confined by a runner
- **WHEN** the agent runs a command ending in `exit 3`, one whose last native program fails with 5, one whose last cmdlet fails, and one that succeeds
- **THEN** the statuses reported are 3, 5, 1 and 0, and both outputs come back

#### Scenario: PowerShellOutputIsUtf8AndProgressIsOff
- **GIVEN** the `powershell` tool confined by a runner
- **WHEN** the agent runs a command printing non-ASCII text and reading `$ProgressPreference`
- **THEN** the text comes back intact and the preference is `SilentlyContinue`
