# CLI Specification

## Purpose

The `pi-outpost` binary: what `npx pi-outpost` installs and runs, the flags it accepts, and the
`init` command that writes a starting configuration. The published package carries the bundled
server and the built web UI, so there is nothing to clone and nothing to build.

## Requirements

### Requirement: PublishedCliPackage

The project SHALL publish a `pi-outpost` package to npm that runs the server with no clone and no build step: `npx pi-outpost`. The package SHALL contain the bundled server and the built web UI, and SHALL declare a `pi-outpost` binary. The server SHALL locate the web UI inside the package it was installed as, and SHALL keep working from a repository clone and from the SEA layout without code changes.

#### Scenario: RunFromNpx
- **GIVEN** a machine with Node and a valid config file, and no pi-outpost clone
- **WHEN** the user runs `npx pi-outpost`
- **THEN** the server starts and serves the web UI at the configured host and port

#### Scenario: WebUiShippedInTheTarball
- **WHEN** the package is packed
- **THEN** the tarball contains the server bundle and the web UI's `index.html` and assets
- **AND** packing fails if the web UI was not built

### Requirement: CliFlags

The binary SHALL accept `--config <path>`, `--profile <name>`, `--cwd <dir>`, `--agent-dir <dir>`, `--port <n>`, `--host <addr>`, `--help` and `--version`. Relative paths given on the command line SHALL be resolved against the current directory (paths inside a config file remain relative to that file). The binary SHALL NOT accept a flag carrying the auth token. An unknown flag SHALL be an error that names the flag and points at `--help`.

#### Scenario: HelpListsEveryFlag
- **WHEN** the user runs `pi-outpost --help`
- **THEN** it prints every flag, the config discovery order, and exits zero

#### Scenario: UnknownFlag
- **WHEN** the user runs `pi-outpost --porte 8080`
- **THEN** it exits non-zero, names the unknown flag, and suggests `--help`

#### Scenario: VersionMatchesThePackage
- **WHEN** the user runs `pi-outpost --version`
- **THEN** it prints the version of the installed package

### Requirement: InitCommand

`pi-outpost init` SHALL write a starter configuration file and print its path: `./pi-outpost.config.json` by default, or `config.json` in the user config directory with `--global`. It SHALL refuse to overwrite an existing file unless `--force` is given. The file it writes SHALL be valid input for the server as-is.

#### Scenario: InitWritesAStartableConfig
- **GIVEN** a directory with no config file
- **WHEN** the user runs `pi-outpost init` and then `pi-outpost`
- **THEN** the server starts

#### Scenario: InitDoesNotClobber
- **GIVEN** a `pi-outpost.config.json` already exists
- **WHEN** the user runs `pi-outpost init`
- **THEN** it exits non-zero, leaves the file untouched, and mentions `--force`
