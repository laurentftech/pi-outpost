## ADDED Requirements

### Requirement: DoctorCommand

`pi-outpost doctor` SHALL report whether this installation can start and serve, and name
what stops it. It SHALL run without a configuration file, SHALL evaluate every check
even after one has failed, and SHALL exit non-zero when any finding would stop the
server from serving.

#### Scenario: DoctorAnswersWhereAStartRefuses
- **GIVEN** a directory with no `pi-outpost.config.json`, and no user-level `config.json`
- **WHEN** the operator runs `pi-outpost doctor`
- **THEN** a full report is printed, naming both paths that were searched
- **AND** it says the server refuses to start before it binds a port
- **AND** it offers both `pi-outpost init` and `pi-outpost init --global`, stating that a
  global install writes neither file
- **AND** the command exits 1

#### Scenario: DoctorNamesTheConfigurationAStartWouldRead
- **GIVEN** a configuration file that a start would resolve
- **WHEN** the operator runs `pi-outpost doctor`
- **THEN** the file is reported, marked among the candidates in the order they are searched
- **AND** a file named explicitly by a flag or environment variable is reported as such,
  without a search that did not happen being described

#### Scenario: DoctorEchoesAMissingNamedConfig
- **GIVEN** `--config` naming a file that does not exist
- **WHEN** the operator runs `pi-outpost doctor`
- **THEN** the report carries that exact path and the command exits 1

#### Scenario: DoctorReportsEveryProblemInOneRun
- **GIVEN** an installation with more than one thing wrong
- **WHEN** the operator runs `pi-outpost doctor`
- **THEN** every check still runs after a failing one, and all findings appear in one report

#### Scenario: DoctorNamesWhatHoldsTheAddress
- **GIVEN** the configured host and port
- **WHEN** the address is probed
- **THEN** a free port is reported as bindable
- **AND** a port answering `/health` as this server does is a warning naming the URL
- **AND** a port held by anything else is a failure that names `--port`

#### Scenario: DoctorReportsAnInstallationWithNoInterface
- **GIVEN** neither an embedded web bundle nor a `dist` carrying an `index.html`
- **WHEN** the operator runs `pi-outpost doctor`
- **THEN** it reports that the server would start and answer 404 for every page
- **AND** the remedy differs for a source checkout and for an installed copy

#### Scenario: DoctorNeverEchoesTheToken
- **GIVEN** a configuration carrying `server.token`
- **WHEN** the settings are reported
- **THEN** the token is reported as set and its value never appears

#### Scenario: DoctorExitCodeMarksABlockedServer
- **GIVEN** findings that include warnings but no failures
- **THEN** the command exits 0
- **GIVEN** any finding that would stop the server from serving
- **THEN** the command exits 1
