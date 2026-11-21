# Spec Delta

## MODIFIED Requirements

### Requirement: AutoFailsClosed

When no candidate passes, every shell command SHALL be refused with the reason, no command SHALL run
confined or not, and the session's other tools SHALL keep working. The reason SHALL say that no command
runs unconfined and how to work unconfined, and what that costs; where the cause is a Windows update the
machine lacks, it SHALL name the installed build, the update and the build that brings it, and say to
install it before naming the way round. The console SHALL say the shell is refused, with the same
reason, even when the check fails before the server has finished starting; until the check has
answered, it SHALL NOT say the shell is confined.

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

## ADDED Requirements

### Requirement: AMachineThatCannotConfineIsSaidOnce

When the agent's shell is on and the runner the server chose cannot confine on this machine, the
interface SHALL say so in a dialog, once per cause in a browser: what is missing, what it means for
the agent, what to do, and the way to work unconfined with what it costs. It SHALL NOT offer to run
commands unconfined: that stays a line in the configuration file. The shell's padlock SHALL name the
cause when it is a Windows update, and SHALL open the dialog again.

#### Scenario: AMachineThatCannotConfineIsSaidOnce
- **GIVEN** a Windows 11 26100 below build 9278, `allowBash` and `bashRunner: "auto"`
- **WHEN** the interface opens, the dialog is closed, the page reloaded, and the padlock clicked
- **THEN** the dialog names the build, the update and the build that brings it, with Windows Update to open; once closed it is not shown again on reload or in another tab; the padlock reads "Windows update needed" and opens it again
