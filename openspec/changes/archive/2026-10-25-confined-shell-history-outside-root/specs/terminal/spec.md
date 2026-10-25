## MODIFIED Requirements

### Requirement: AConfinedTerminalGetsAMinimalEnvironment

A confined terminal SHALL receive only the variables a shell needs — search path, locale, terminal type,
shell, a home inside the sandbox root, a private npm cache, and the user's git configuration as
`GIT_CONFIG_GLOBAL` when they have one — and SHALL NOT receive the server's other variables, provider
keys included. That git configuration file SHALL be readable inside, read-only, and nothing beside it.
The shell's history SHALL be kept in the terminal's private temp, never in the sandbox root.

#### Scenario: KeysDoNotReachTheShell
- **GIVEN** the server started with `OPENAI_API_KEY` in its environment and a confined terminal
- **WHEN** the user lists the shell's environment
- **THEN** `OPENAI_API_KEY` is absent

#### Scenario: GitKnowsWhoCommits
- **GIVEN** a user whose `~/.gitconfig` names them, and a confined terminal
- **WHEN** git reads its identity in the terminal
- **THEN** it is the user's, the file cannot be written, and the folder it sits in stays unreadable

#### Scenario: AClosedTerminalLeavesNoHistoryInTheProject
- **GIVEN** a confined terminal on Linux or macOS in which the user typed a command
- **WHEN** the terminal is closed and its shell has exited
- **THEN** no shell history file is left in the sandbox root
