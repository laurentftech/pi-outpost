# Spec Delta

## ADDED Requirements

### Requirement: TheAgentIsToldWhereTheUsersHomeIs

A confined command and a confined terminal SHALL have `PI_OUTPOST_USER_HOME`, naming the user's own home (on Windows the server's `USERPROFILE`), except in a WSLC container. The confined shell tool's guidelines SHALL say that `HOME` is the project folder, name the user's home, and say that a path under `~` named by the user or a document is there and read with a grant. Naming the home SHALL NOT give access to it.

#### Scenario: TheUsersHomeIsNamed
- **GIVEN** a confined PowerShell under MXC, and a file in the user's home
- **WHEN** a command reads `$env:PI_OUTPOST_USER_HOME` and that file
- **THEN** the variable names the user's profile; the file is refused without a grant and read with a read grant on it

#### Scenario: TheAgentIsToldHomeIsTheProject
- **GIVEN** the agent's shell confined by a runner
- **WHEN** the session's tools are built
- **THEN** the guidelines say `HOME (~)` is the project folder and name the user's home and `PI_OUTPOST_USER_HOME`; an unconfined shell's do not
