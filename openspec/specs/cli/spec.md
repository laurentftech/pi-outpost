# CLI Specification

## Purpose

The `pi-outpost` binary: what `npx pi-outpost` installs and runs, the flags it accepts, and the
`init` command that writes a starting configuration. The published package carries the bundled
server and the built web UI, so there is nothing to clone and nothing to build.

## Requirements

### Requirement: PublishedCliPackage

The project SHALL publish a `pi-outpost` package to npm that runs the server with no clone and no build step: `npx pi-outpost`. The package SHALL contain the bundled server and the built web UI, and SHALL declare a `pi-outpost` binary. The server SHALL locate the web UI inside the package it was installed as, and SHALL keep working from a repository clone and from the SEA layout without code changes.

The package SHALL also carry what building a standalone executable from it requires, so that an installation is sufficient on its own — nothing to fetch, nothing to clone, nothing to write by hand.

#### Scenario: RunFromNpx
- **GIVEN** a machine with Node and a valid config file, and no pi-outpost clone
- **WHEN** the user runs `npx pi-outpost`
- **THEN** the server starts and serves the web UI at the configured host and port

#### Scenario: WebUiShippedInTheTarball
- **WHEN** the package is packed
- **THEN** the tarball contains the server bundle and the web UI's `index.html` and assets
- **AND** packing fails if the web UI was not built

#### Scenario: TheTarballCarriesWhatABuildNeeds
- **WHEN** the package is packed
- **THEN** the tarball contains everything `build-exe` reads, and building an executable from a fresh install requires no other download

### Requirement: CliFlags

The binary SHALL accept `--config <path>`, `--profile <name>`, `--cwd <dir>`, `--agent-dir <dir>`, `--port <n>`, `--host <addr>`, `--help` and `--version`. Relative paths given on the command line SHALL be resolved against the current directory (paths inside a config file remain relative to that file). The binary SHALL NOT accept a flag carrying the auth token. An unknown flag SHALL be an error that names the flag and points at `--help`.

The binary SHALL additionally accept a `build-exe` subcommand, and `--out <path>` and `--force` flags that apply to it. It SHALL accept `--open` and `--no-open`, which decide whether starting the server launches a browser, and which apply wherever the server starts rather than to any one subcommand. A flag given outside the subcommand it belongs to SHALL be an error like any other misplaced flag, rather than being silently ignored.

The binary SHALL additionally accept an `update` subcommand, and a `--check` flag that applies to it, subject to the same rule.

#### Scenario: HelpListsEveryFlag
- **WHEN** the user runs `pi-outpost --help`
- **THEN** it prints every flag, the config discovery order, and exits zero

#### Scenario: UnknownFlag
- **WHEN** the user runs `pi-outpost --porte 8080`
- **THEN** it exits non-zero, names the unknown flag, and suggests `--help`

#### Scenario: VersionMatchesThePackage
- **WHEN** the user runs `pi-outpost --version`
- **THEN** it prints the version of the installed package

#### Scenario: HelpDocumentsTheBuildCommand
- **WHEN** the user runs `pi-outpost --help`
- **THEN** the `build-exe` subcommand, its options, and the browser-opening flags appear alongside the other commands

#### Scenario: HelpDocumentsTheUpdateCommand
- **WHEN** the user runs `pi-outpost --help`
- **THEN** the `update` subcommand and its `--check` flag appear alongside the other commands

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

### Requirement: LoginCommand

`pi-outpost login --provider <name>` SHALL store an API key for that provider in the configured agent directory's `auth.json`, through the SDK's auth storage, and print where it wrote it. It SHALL read the key from a non-echoing prompt on a TTY, and from standard input when piped. It SHALL NOT accept the key as a command-line argument — a secret in argv is readable by anyone who can list processes, the same reason there is no `--token` flag. It SHALL resolve the agent directory the same way the server does, so the key lands where the server will look for it.

#### Scenario: LoginThenStart
- **GIVEN** a configuration with an agent directory holding no credentials
- **WHEN** the user runs `pi-outpost login --provider <name>`, supplies a key, and then starts the server
- **THEN** the server reports a usable model and the chat answers

#### Scenario: LoginFromAScript
- **WHEN** a key is piped into `pi-outpost login --provider <name>`
- **THEN** it is read from standard input, stored, and never appears in the process arguments

#### Scenario: LoginRejectsAKeyInArgv
- **WHEN** the user passes the key as a flag value
- **THEN** the command exits non-zero and explains that the key must come from stdin or the prompt

### Requirement: StartingOpensTheInterface

However the server was started — from a package runner, from an installed binary, or
from a standalone executable — starting it for a person SHALL open the interface at
the address the server is actually listening on, once it is listening and not before.
Anyone who starts this reads the address off the terminal and pastes it into a
browser; the software can do that itself.

It SHALL be opened in a window of its own — without tabs or an address bar — where
the machine can present one. This is what the interface is: an application that was
launched, not a page that was visited. Where no such window can be presented, it
SHALL open in the default browser, exactly as it does otherwise; the shape of the
window SHALL be overridable from the command line and from configuration, in both
directions.

The address SHALL be the one bound, not the one requested: where the port was chosen
by the operating system, the opened address SHALL be the port it chose.

Whether to open SHALL be decided by whether a browser can be shown at all — a
desktop session exists — and not by whether a terminal is attached: an executable
launched from a file manager has no terminal and is exactly the case that most needs
opening. It SHALL be suppressed where a browser is the wrong answer: no desktop
session, a container or a service, or a server that exists to back an interface
hosted elsewhere. The decision SHALL be overridable in both directions from the
command line and from configuration.

A failure to open SHALL NOT be a failure to start: the server SHALL keep running and
SHALL print the address, which is what the operator would have read anyway. This
SHALL hold for a window of its own exactly as it holds for a browser tab, and failing
to present one SHALL NOT be reported as an error the operator must act on.

#### Scenario: StartingOnADesktopOpensTheInterface
- **GIVEN** a machine with a desktop session
- **WHEN** the operator starts the server
- **THEN** the interface opens, and it is being served by the time the page loads

#### Scenario: ItOpensInAWindowOfItsOwn
- **GIVEN** a machine that can present a window without tabs or an address bar
- **WHEN** the server is started for a person
- **THEN** the interface appears in such a window

#### Scenario: WhereNoOwnWindowIsPossible
- **GIVEN** a machine whose browser cannot present a window of its own
- **WHEN** the server is started for a person
- **THEN** the interface opens in the default browser, as it does today
- **AND** the server reports no error for it

#### Scenario: TheOperatorCanAskForATab
- **WHEN** the operator asks for the interface in the default browser rather than its own window
- **THEN** it opens in the default browser, on a machine that could have presented its own window

#### Scenario: LaunchedWithoutATerminal
- **GIVEN** a standalone executable launched from a file manager, with no terminal attached
- **THEN** the interface still opens — the absence of a terminal is not the absence of a person

#### Scenario: TheOpenedAddressIsTheBoundOne
- **GIVEN** a configuration that lets the operating system choose the port
- **WHEN** the interface is opened
- **THEN** the address it opens is the one the server bound, not the one configured

#### Scenario: NothingOpensWhereNothingCanSeeIt
- **WHEN** the server runs with no desktop session available
- **THEN** nothing is launched, and the address is printed as usual

#### Scenario: TheOperatorCanSaySoEitherWay
- **WHEN** the operator asks for no browser, or asks for one where it would not have opened
- **THEN** the request is honoured

#### Scenario: AFailedOpenIsNotAFailedStart
- **GIVEN** a machine where launching a browser fails
- **WHEN** the server starts
- **THEN** it is running and serving, and the address is printed

### Requirement: AFailureToStartIsSaidOutLoud

A server that cannot start SHALL report why in the same voice as every other failure this
binary can have: one line naming what went wrong, and a non-zero exit. This holds wherever
the start fails — no configuration file to be found, a flag that will not parse, or a port
that will not bind. It SHALL NOT exit on an unhandled error, and it SHALL NOT print a stack
trace as its explanation — a stack is where the code was, not what the operator must do.

An address already in use SHALL be named for what it is. The message SHALL carry the host
and port that were refused, and SHALL name the way to move it, so that reading the line is
enough to act on it. Any other reason a bind fails SHALL still produce a readable line
rather than a trace.

The message SHALL survive the console it was printed on, for every one of those failures.
Where the process owns that console — a standalone executable started from a file manager,
which is how the interface is meant to be opened and which has no terminal behind it — the
process SHALL hold it open until the operator dismisses it, because exiting would close the
window and take the only copy of the message with it. Where the console belongs to
something else — a shell, a script, a continuous integration runner — the process SHALL
exit immediately and wait for no one.

A server that starts SHALL be unaffected: nothing added to its output, and nothing to
dismiss.

#### Scenario: ThePortIsAlreadyTaken
- **GIVEN** something is already listening on the host and port the server was asked to bind
- **WHEN** the operator starts the server
- **THEN** it exits non-zero having printed a single line that names that host and port and the flag that moves it
- **AND** no stack trace is printed

#### Scenario: TheBindFailsForSomeOtherReason
- **GIVEN** an address the machine will not let this process bind
- **WHEN** the operator starts the server
- **THEN** it exits non-zero having printed a readable line naming the failure, not a stack trace

#### Scenario: TheMessageOutlivesTheWindow
- **GIVEN** a launch that owns its console, with no terminal behind it
- **WHEN** the server fails to start
- **THEN** the process holds the console open until the operator dismisses it, so the message can be read

#### Scenario: AFailureBeforeListeningIsHeldToo
- **GIVEN** a launch that owns its console
- **WHEN** the start fails before it reaches the port — no configuration file, or a flag that will not parse
- **THEN** the console is held open until the operator dismisses it, exactly as a bind failure is
- **AND** the same launch from a shell exits at once, with the message and no prompt

#### Scenario: NobodyElseIsMadeToWait
- **GIVEN** a launch from a shell, a script, or a continuous integration runner
- **WHEN** the server fails to start
- **THEN** it exits immediately, waiting for no input

#### Scenario: AServerThatStartsIsUnchanged
- **WHEN** the server binds successfully
- **THEN** it prints what it prints today, waits for nothing, and keeps running

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
