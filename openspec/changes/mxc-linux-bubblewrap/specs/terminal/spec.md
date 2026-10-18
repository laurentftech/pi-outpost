## ADDED Requirements

### Requirement: OnLinuxMxcMayConfineTheTerminal

On Linux, `terminal.sandbox` MAY name MXC's Linux executor. When an interactive shell runs through it,
the terminal SHALL keep the limits of `TheTerminalMayRunConfined`; when it cannot, the terminal SHALL be
unavailable with the reason, and the agent's shell SHALL NOT be affected.

#### Scenario: OnLinuxWithMxcGitRunsInTheTerminal
- **GIVEN** a confined terminal under MXC's real Linux executor in a git repository that is its writable root
- **WHEN** the user runs `git status` and reads the agent directory's `auth.json`
- **THEN** git answers, and the read is refused
