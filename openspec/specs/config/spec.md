# Configuration Specification

## Purpose

Where the server's configuration comes from, and who wins when several places answer. One file is
read — the first of six locations that exists — and never merged with another, so the file you are
reading is the configuration that is running. Above it: environment variables, then command-line
flags. Below it: nothing. Without a configuration file the server refuses to start rather than
inventing a permissive one.

## Requirements

### Requirement: ConfigDiscoveryOrder

The server SHALL look for its configuration file in this order, and SHALL use the first one it finds: the path given by `--config`, then `PI_OUTPOST_CONFIG`, then `pi-outpost.config.json` in the launch directory, then `config.json` under the user config directory (`$XDG_CONFIG_HOME/pi-outpost`, defaulting to `~/.config/pi-outpost`). Exactly one file SHALL be read — configurations SHALL NOT be merged across locations. A path given explicitly (`--config`, `PI_OUTPOST_CONFIG`) that does not exist SHALL be an error; the two implicit locations SHALL be skipped when absent. The server SHALL log the path of the file it loaded.

#### Scenario: LocalFileWinsOverUserFile
- **GIVEN** both `./pi-outpost.config.json` and `~/.config/pi-outpost/config.json` exist
- **WHEN** the server starts with no `--config` and no `PI_OUTPOST_CONFIG`
- **THEN** it loads the local file, and no key of the user-level file takes effect

#### Scenario: UserFileUsedWhenNoLocalFile
- **GIVEN** only `~/.config/pi-outpost/config.json` exists
- **WHEN** the server starts from a directory with no config file
- **THEN** it loads the user-level file and logs its path

#### Scenario: ExplicitPathMissing
- **WHEN** `--config ./nope.json` names a file that does not exist
- **THEN** the server exits with an error naming that path

### Requirement: ConfigPrecedence

For every setting that can come from more than one place, the server SHALL apply: command-line flag, then environment variable, then config file, then built-in default — the first one present wins. The `PI_OUTPOST_PORT` environment variable SHALL fall back to `PORT` when unset, so that a platform-injected `PORT` is honoured.

#### Scenario: EnvOverridesFile
- **GIVEN** a config file with `server.port` set to 3141
- **WHEN** the server starts with `PI_OUTPOST_PORT=8080`
- **THEN** it listens on 8080

#### Scenario: FlagOverridesEnv
- **GIVEN** `PI_OUTPOST_PORT=8080` in the environment
- **WHEN** the server starts with `--port 9000`
- **THEN** it listens on 9000

#### Scenario: TokenNeverComesFromArgv
- **WHEN** the CLI is invoked with an unknown `--token` flag
- **THEN** it exits with an error, because a secret passed on the command line is readable by any process listing

### Requirement: ConfigProfiles

The server SHALL accept a profile name (`--profile <name>` or `PI_OUTPOST_PROFILE`) and SHALL load `profiles/<name>.json` from the user config directory. A profile file SHALL be an ordinary config file, subject to the same validation and the same relative-path resolution. Naming both a profile and an explicit `--config` path SHALL be an error. A named profile that does not exist SHALL be an error.

#### Scenario: ProfileSelectsUserFile
- **GIVEN** `~/.config/pi-outpost/profiles/work.json` exists
- **WHEN** the server starts with `--profile work`
- **THEN** it loads that file, even if `./pi-outpost.config.json` also exists

#### Scenario: ProfileAndConfigTogether
- **WHEN** the server starts with both `--profile work` and `--config other.json`
- **THEN** it exits with an error

### Requirement: RefuseToStartWithoutConfig

When no configuration file is found in any location, the server SHALL exit with a non-zero status and a message telling the user how to create one (`pi-outpost init`, or `pi-outpost init --global`). It SHALL NOT fall back to an implicit permissive configuration.

#### Scenario: BareInvocationInAnEmptyDirectory
- **WHEN** `pi-outpost` runs in a directory with no config file, no `PI_OUTPOST_CONFIG`, and no user-level config
- **THEN** it exits non-zero, prints the locations it looked in, and names `pi-outpost init`
- **AND** no agent session is created and no port is bound
