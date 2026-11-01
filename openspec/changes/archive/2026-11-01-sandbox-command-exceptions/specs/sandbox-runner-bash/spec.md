# Spec Delta

## MODIFIED Requirements

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
