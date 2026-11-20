# Spec Delta

## ADDED Requirements

### Requirement: UnderMxcOnWindowsTheTemporaryDirectoryIsTheCommands

Under MXC on Windows, a confined command's `TEMP`, `TMP` and `LOCALAPPDATA` SHALL name folders that exist
and are writable, inside its private temporary directory, so a tool can create temporary files and keep its
per-user state there; no folder the policy denies SHALL be opened for it.

#### Scenario: OnWindowsATemporaryFileCanBeCreated
- **GIVEN** the agent's shell confined by MXC on Windows 11 tier 1
- **WHEN** a command creates a file in `$env:TEMP` and calls `[IO.Path]::GetTempFileName()`
- **THEN** both succeed, inside the command's private temporary directory

#### Scenario: OnWindowsGccCompiles
- **GIVEN** the same shell and a gcc on the search path whose installation is readable
- **WHEN** a command compiles and runs a C file
- **THEN** it compiles without "Cannot create temporary file" and the program runs

### Requirement: UnderMxcOnWindowsAnInstallationBehindTheSearchPathIsReadable

Under MXC on Windows, each search-path folder named `bin`, `cmd`, `Scripts` or `sbin` SHALL have the folder
above it readable, read only, unless that folder is a drive's root, the home directory or above it, or holds
or lies inside the agent directory or the configuration.

#### Scenario: OnWindowsCmakeFindsItsModules
- **GIVEN** `C:\Strawberry\c\bin` on the search path of the agent's shell confined by MXC
- **WHEN** a command configures and builds a CMake project
- **THEN** CMake finds its modules under `C:\Strawberry\c\share` and the build succeeds

#### Scenario: OnWindowsMavenStarts
- **GIVEN** Maven's `bin` on the search path
- **WHEN** a command runs `mvn -v`
- **THEN** Maven starts, reading its `boot` folder

#### Scenario: AnInstallationParentNeverOpensTheProfile
- **GIVEN** search-path entries `C:\bin`, `C:\Users\me\bin`, and a `bin` folder holding the agent directory's parent
- **WHEN** the request is built
- **THEN** none of their parents is made readable

### Requirement: UnderMxcOnWindowsToolCachesLastInTheSandboxCache

Under MXC on Windows, the caches and homes where a confined command's tools keep downloads — Cargo, Gradle,
Go, Maven, NuGet, bun, npm, uv, pip, and `APPDATA` — SHALL be folders of a sandbox cache directory,
writable by confined commands and created on first use, so a dependency is downloaded once per user.

#### Scenario: ADependencyIsDownloadedOnce
- **GIVEN** a Go module with a dependency, in the agent's shell confined by MXC on Windows
- **WHEN** two commands run `go build` one after the other
- **THEN** both succeed and only the first downloads the dependency

#### Scenario: GradlesWrapperRunsConfined
- **GIVEN** a Gradle project with its wrapper
- **WHEN** a command runs `gradlew test` twice
- **THEN** both pass, and the second does not download Gradle's distribution again

#### Scenario: NpmsGlobalPrefixIsNotInTheProject
- **GIVEN** a Node project in the agent's shell confined by MXC on Windows
- **WHEN** a command runs `npm root -g`
- **THEN** it names a folder of the sandbox cache, and no `${APPDATA}` folder appears in the project

### Requirement: TheSandboxCacheHasItsOwnPlace

The sandbox cache SHALL default to `%LOCALAPPDATA%\pi-outpost\sandbox-cache` and MAY be moved by
`sandbox.cacheDir`, which SHALL be refused when it is or holds the user's home, the agent directory or the
configuration, or lies inside the sandbox root.

#### Scenario: TheSandboxCacheIsNotTheUsers
- **GIVEN** `sandbox.cacheDir` naming the user's home, the agent directory, or a folder inside the sandbox root
- **WHEN** the configuration is loaded
- **THEN** it is refused with a reason naming the key

### Requirement: UnderMxcOnWindowsToolchainHomesAreReadable

Under MXC on Windows, rustup's home (`RUSTUP_HOME`, by default `~\.rustup`) and the folder of Pythons uv
installed (by default `%APPDATA%\uv\python`) SHALL be readable, read only, when they exist, and a confined
command's environment SHALL name them, so `cargo`, `rustc` and `uv` find what the user installed. Homes that
may hold credentials — Cargo's, Maven's, Gradle's, npm's configuration — SHALL NOT be made readable.

#### Scenario: OnWindowsCargoTestsConfined
- **GIVEN** a Rust toolchain installed by rustup for the user and a crate with a registry dependency
- **WHEN** a command in the agent's shell confined by MXC runs `cargo test`
- **THEN** the toolchain is found and the tests pass

#### Scenario: CargoCredentialsStayOut
- **GIVEN** a `~\.cargo\credentials.toml` holding a token
- **WHEN** a confined command reads it
- **THEN** the read is refused and the token does not appear

#### Scenario: UvFindsTheUsersPythons
- **GIVEN** a Python installed by `uv python install` and a uv project with no `.venv`
- **WHEN** a confined command runs `uv sync` then `uv run python -V`
- **THEN** uv uses that Python without downloading one

### Requirement: UnderMxcOnWindowsMsysProgramsLeaveTheSearchPath

Under MXC on Windows, a search-path folder holding `msys-2.0.dll` SHALL be left out of a confined command's
search path, since no MSYS2 program can start in the container. A command whose program fails to start with
`0xC0000142` from such a folder SHALL end with a note saying MSYS2 programs cannot run in the sandbox and
naming a native alternative's absence.

#### Scenario: OnWindowsPerlIsTheNativeOne
- **GIVEN** a search path holding `C:\Program Files\Git\usr\bin` before `C:\Strawberry\perl\bin`
- **WHEN** a confined command runs `perl -e "print 1"`
- **THEN** Strawberry's Perl runs and prints `1`

#### Scenario: AnMsysProgramNamedDirectlyIsExplained
- **GIVEN** the agent's shell confined by MXC on Windows
- **WHEN** a command runs `& "C:\Program Files\Git\usr\bin\perl.exe" -e 1`
- **THEN** it fails, and the output ends with a note saying MSYS2 programs cannot start in the sandbox

### Requirement: UnderMxcOnWindowsBunRunsAndItsInstallLimitIsSaid

Under MXC on Windows, `bun run` and `bun test` SHALL work for bun 1.4.5 or later. A confined command whose
output holds bun's `EBADF accessing temporary directory` SHALL end with a note saying the container refuses
renames relative to a directory handle, that `bun install` cannot complete inside it until MXC or bun
changes, and that the user can run it outside the sandbox.

#### Scenario: OnWindowsBunRunsAndTests
- **GIVEN** bun 1.4.5 and a project with a script and a `bun:test` file
- **WHEN** a confined command runs `bun run index.ts` then `bun test`
- **THEN** the script prints its output and the test passes

#### Scenario: BunInstallsFailureIsExplained
- **GIVEN** the same project
- **WHEN** a confined command runs `bun add is-odd`
- **THEN** it fails, and the output ends with the note naming the rename limit and running it outside the sandbox
