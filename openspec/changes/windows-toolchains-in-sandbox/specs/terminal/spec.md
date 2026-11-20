# Spec Delta

## ADDED Requirements

### Requirement: UnderMxcOnWindowsTheTerminalRunsToolchains

A terminal confined by MXC on Windows SHALL get what the agent's confined shell gets for toolchains: `TEMP`,
`TMP` and `LOCALAPPDATA` inside its private temporary directory, the installations behind its search path
readable, the sandbox cache for tool caches, and rustup's and uv's homes readable.

#### Scenario: OnWindowsTheTerminalBuildsAGoModule
- **GIVEN** a terminal confined by MXC tier 1 on Windows and a Go module with a dependency
- **WHEN** the user runs `go build` then the program
- **THEN** it builds and runs

#### Scenario: OnWindowsTheTerminalHasAWritableTemp
- **GIVEN** the same terminal
- **WHEN** the user creates a file in `%TEMP%`
- **THEN** it is created in the terminal's private temporary directory
