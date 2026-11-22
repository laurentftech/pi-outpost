# Spec Delta

## ADDED Requirements

### Requirement: PowerShellsDriveLineIsNotShown

The output of a command run in a confined PowerShell SHALL NOT begin with PowerShell's own line that it could not initialise a drive (`InitializeDefaultDrives`), which it prints, before the command runs, for a drive of the user's session the sandbox does not reach. A command's own line that contains those words after its first output SHALL be kept.

#### Scenario: TheDriveLineIsNotShown
- **GIVEN** a machine with a mapped network drive, and the agent's shell PowerShell confined by MXC
- **WHEN** the agent runs a command
- **THEN** its output does not start with the `InitializeDefaultDrives` line, and the command's own output is whole

### Requirement: TheAgentIsToldWhatItsSandboxEnds

The description of a confined shell SHALL say that a process a command starts in the background ends with that command, and where to run a server or a long job instead. Under MXC on Windows it SHALL also say that WMI is unavailable and how to read the machine's free memory.

#### Scenario: TheAgentIsToldBackgroundProcessesEnd
- **GIVEN** the agent's shell confined by a runner
- **WHEN** the session's tools are built
- **THEN** the shell tool's guidelines say a background process ends with its command

#### Scenario: TheAgentIsToldThereIsNoWmi
- **GIVEN** the agent's shell confined by MXC on Windows
- **WHEN** the session's tools are built
- **THEN** the guidelines say `Get-CimInstance` fails and name the .NET way to read the free memory; under another runner they do not

### Requirement: AWalDatabaseUnderAReadGrantSaysWhatToDo

When SQLite reports it cannot open a database in a command run with a folder granted read-only, a note SHALL follow the output: a database in WAL mode writes its `-wal` and `-shm` files to be read, and it can be opened with `immutable=1` when nothing writes it, or with a write grant.

#### Scenario: AWalDatabaseUnderAReadGrantSaysWhatToDo
- **GIVEN** a SQLite database in WAL mode in a folder granted read-only
- **WHEN** a command opens it with `mode=ro`
- **THEN** SQLite's `unable to open database file` is followed by the note; a command with no read grant gets no note
