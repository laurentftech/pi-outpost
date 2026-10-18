## ADDED Requirements

### Requirement: OnMacOsMxcMayConfineTheTerminal

On macOS on Apple silicon, `terminal.sandbox` MAY name MXC's macOS executor. The terminal SHALL then keep
the limits of `TheTerminalMayRunConfined`, its size and resizes SHALL reach the shell, Ctrl-C SHALL
interrupt the running command without ending the shell, and the shell's working directory SHALL be
found as for an unconfined terminal.

#### Scenario: OnMacOsWithMxcGitRunsInTheTerminal
- **GIVEN** a confined terminal under MXC's real macOS executor in a git repository that is its writable root
- **WHEN** the user runs `git status` — in the shell pi-outpost starts by default, zsh included — and reads the agent directory's key file
- **THEN** git answers without warnings and leaves nothing in the root, and the read is refused

#### Scenario: OnMacOsTheConfinedTerminalBehavesAsATerminal
- **GIVEN** a confined terminal under MXC's real macOS executor, opened at 40 rows by 120 columns
- **WHEN** the user asks the size, resizes it, interrupts a running `sleep`, and changes directory
- **THEN** the shell reports each size, the interrupted command ends with status 130 while the shell lives, and the server finds the new working directory
