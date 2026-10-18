## ADDED Requirements

### Requirement: GitSeesTheUsersGlobalIgnore

A confined shell SHALL be able to read, and not write, the files the user's `~/.gitconfig` names in
`core.excludesFile` and `core.attributesFile`, when they exist; it SHALL NOT be given their folder.

#### Scenario: GitAppliesTheGlobalIgnoreQuietly
- **GIVEN** a user whose `~/.gitconfig` names a global ignore file in the home folder that ignores `*.log`, and a confined shell in a git repository holding `debug.log`
- **WHEN** the shell runs `git status`
- **THEN** git prints no warning about that file, does not list `debug.log`, and the home folder stays unreadable
