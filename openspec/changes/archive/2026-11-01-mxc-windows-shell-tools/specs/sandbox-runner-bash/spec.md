# Spec Delta

## ADDED Requirements

### Requirement: UnderMxcOnWindowsTheSearchPathIsReadable

Under MXC on Windows, a confined command SHALL be able to read every absolute folder its `PATH` names,
so that a program found on `PATH` runs, even inside the user's denied profile. A folder that is or holds
the home directory, holds the agent directory or the configuration file, or is a drive's root SHALL NOT
be made readable by this, and the agent directory and the configuration file SHALL stay denied.

#### Scenario: AToolInstalledForTheUserRuns
- **GIVEN** the agent's shell confined by MXC on Windows, and Python installed for the user under `AppData\Local\Programs`, its folder on `PATH`
- **WHEN** a command runs `python --version` and a line of Python
- **THEN** both run, while the agent directory's keys file is still refused and the profile's other folders stay out of reach

### Requirement: ABareShellIsFoundOnThePath

A `sandbox.bashShell` given as a bare name SHALL be looked up on `PATH` when the configuration loads,
with `PATHEXT` on Windows, and SHALL run from what is found there. One not on `PATH` SHALL stop startup
with a message naming it. A path SHALL be resolved against the configuration's folder, as before.

#### Scenario: ABareShellNameIsFoundOnThePath
- **GIVEN** `sandbox.bashShell: "pwsh.exe"` and PowerShell 7 on `PATH`
- **WHEN** the configuration loads, and the agent's shell runs under MXC
- **THEN** the shell is PowerShell 7 from `PATH`, and the canary finds it confined; a name not on `PATH` stops startup saying so
