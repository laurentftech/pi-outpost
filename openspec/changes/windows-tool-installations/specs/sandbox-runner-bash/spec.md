# Spec Delta

## MODIFIED Requirements

### Requirement: UnderMxcOnWindowsTheSearchPathIsReadable

Under MXC on Windows, a confined command SHALL be able to read every absolute folder its `PATH` names,
so that a program found on `PATH` runs, even inside the user's denied profile. A folder that is or holds
the home directory, holds the agent directory or the configuration file, or is a drive's root SHALL NOT
be made readable by this, and the agent directory and the configuration file SHALL stay denied.

Where such a folder holds launchers for a program elsewhere, the installation they start SHALL be readable
too, read only, followed one step and only to a program that is there: Git for Windows' installation from
its `cmd`, `bin`, `mingw64\bin` or `usr\bin`; the folder of the program a scoop `.shim` names; the target
of a link in the folder, or of the folder itself. The interpreter the project's `.venv\pyvenv.cfg` names in
`home` SHALL be readable when that folder holds `python.exe` and `Lib`, and no other folder it names. Each
folder taken SHALL pass the same guard as the search path's own, and SHALL NOT be inside the agent
directory or the configuration. Only folders inside the home directory SHALL be listed for launchers.

#### Scenario: AToolInstalledForTheUserRuns
- **GIVEN** the agent's shell confined by MXC on Windows, and Python installed for the user under `AppData\Local\Programs`, its folder on `PATH`
- **WHEN** a command runs `python --version` and a line of Python
- **THEN** both run, while the agent directory's keys file is still refused and the profile's other folders stay out of reach

#### Scenario: AGitInstalledForTheUserRuns
- **GIVEN** Git for Windows installed for the user, its `cmd`, `bin`, `mingw64\bin` or `usr\bin` folder on `PATH`
- **WHEN** the agent's shell builds MXC's request on Windows
- **THEN** Git's installation is readable, read only, and a `cmd` folder that is not Git's opens nothing

#### Scenario: APythonAVirtualEnvironmentStandsOnRuns
- **GIVEN** a project whose `.venv\pyvenv.cfg` names in `home` a Python uv installed under the user's profile
- **WHEN** the agent's shell builds MXC's request on Windows
- **THEN** that interpreter's folder is readable, read only

#### Scenario: AForgedVirtualEnvironmentOpensNothing
- **GIVEN** a `.venv\pyvenv.cfg` whose `home` names a folder that is not a Python installation, or the home directory, a folder above it, a drive's root, or the agent directory
- **WHEN** the agent's shell builds MXC's request on Windows
- **THEN** no folder is made readable by it

#### Scenario: ALauncherIsFollowedToItsProgram
- **GIVEN** scoop's `shims`, WinGet's `Links` and nvm-windows' linked folder on `PATH`
- **WHEN** the agent's shell builds MXC's request on Windows
- **THEN** the folder of each program a shim or a link leads to is readable, a shim naming nothing that exists opens nothing, a launcher leading to the home directory, the agent directory or a drive's root opens nothing, and no system folder is listed

## ADDED Requirements

### Requirement: ToolCachesStayPrivate

A confined command's npm, uv and pip caches SHALL be in its private temporary directory
(`npm_config_cache`, `UV_CACHE_DIR`, `PIP_CACHE_DIR`), on every platform: the user's own caches SHALL NOT be
made writable to it.

#### Scenario: ToolCachesStayPrivate
- **GIVEN** a confined command
- **WHEN** its environment is built
- **THEN** npm's, uv's and pip's caches name folders in its private temporary directory

### Requirement: ConfiguredToolDirectoriesAreReadable

`sandbox.readOnlyPaths` SHALL name directories every command of the agent's confined shell may read, in
every project, read only. Each SHALL be checked at every launch as a grant request is, and one that can
never be granted, or that is not an existing directory, SHALL be skipped and said once in the server's log.

#### Scenario: ConfiguredToolDirectoriesAreReadable
- **GIVEN** `sandbox.readOnlyPaths` naming a tool directory, the agent directory, and a directory that does not exist
- **WHEN** a command of the agent's confined shell starts
- **THEN** the tool directory is readable and not writable, the rules still apply beside it, and the two others are skipped, each said once in the log

#### Scenario: ASettingsApplyKeepsReadOnlyPaths
- **GIVEN** `sandbox.readOnlyPaths` naming a directory, and the server running
- **WHEN** the user applies sandbox settings from the interface, which carry no `readOnlyPaths`
- **THEN** the next command can still read the directory, and not write it

#### Scenario: ReadOnlyPathsAreReadFromTheFile
- **GIVEN** a configuration with `sandbox.readOnlyPaths`
- **WHEN** it loads
- **THEN** a relative entry is the configuration folder's, and an empty entry, a value that is not a list, or the key beside `sandbox.bashImage` stops it with a message naming the key

### Requirement: AProgramsFolderIsAskedFor

The agent SHALL be told, by `run_with_grant`'s description and by the note offering a diagnosis, that
"access denied" starting a program installed outside the sandbox is a refused path whose folder it may ask
for, read only — and that what no grant allows is leaving the sandbox: a desktop application, the browser.

#### Scenario: AProgramsFolderIsAskedFor
- **GIVEN** the agent's confined shell with grants on
- **WHEN** the model reads `run_with_grant`'s description, or the note ending a failed command under MXC on Windows
- **THEN** both say that a program's folder refused at start is asked for, read only, and the description still says no grant opens a desktop application or the browser
