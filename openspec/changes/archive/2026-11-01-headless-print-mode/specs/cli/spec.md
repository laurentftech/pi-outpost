# Spec Delta

## ADDED Requirements

### Requirement: APromptCanBeRunWithoutABrowser

`pi-outpost -p "<prompt>"` SHALL run one turn of the agent through the server the configuration
describes — its sandbox, runner, extensions and sessions — bound to the loopback on a free port, open no
browser, and exit once the turn ends. `-p -` SHALL read the prompt from stdin. The assistant's text SHALL
go to stdout; the server's log and the turn's tools and answers SHALL go to stderr. The exit status SHALL
be 0 when the turn ended, and 1 when it failed.

#### Scenario: APromptIsAnsweredOnStdout
- **GIVEN** a configured model
- **WHEN** `pi-outpost -p "Say hello"` runs
- **THEN** stdout holds the assistant's answer and nothing else, stderr holds the server's log, and the exit status is 0

#### Scenario: APromptFromStdin
- **GIVEN** the same configuration
- **WHEN** `pi-outpost -p -` runs with the prompt on stdin
- **THEN** that prompt is the turn's

#### Scenario: AFailedTurnExitsNonZero
- **GIVEN** a model whose provider fails the turn
- **WHEN** `pi-outpost -p "…"` runs
- **THEN** the error is on stderr and the exit status is 1

### Requirement: PrintModeAnswersQuestionsByPolicy

With nobody to click, a grant request SHALL be answered by `--grants`: `refuse` (the default), `once`
or `session`. An extension's dialog SHALL be declined. Each answer SHALL be said on stderr.

#### Scenario: GrantsAreRefusedUnlessAllowed
- **GIVEN** a confined shell under `sandbox.allowedHosts`, and a turn whose command connects to an unlisted host
- **WHEN** it runs with no `--grants`, then with `--grants once`
- **THEN** the first is refused and the second is allowed for that command, and stderr names each answer

### Requirement: PrintModeCanEmitEvents

`--json` SHALL print every event of the turn on stdout, one JSON object per line, in place of the text.

#### Scenario: JsonPrintsTheTurnsEvents
- **GIVEN** a configured model
- **WHEN** `pi-outpost -p "…" --json` runs
- **THEN** each stdout line parses as JSON, and the lines include the turn's start, the assistant's message and its end

### Requirement: PrintFlagsBelongToPrintMode

`--json`, `--grants` and `--model` SHALL be refused without `-p`, `-p` SHALL be refused beside a command,
and `--grants` SHALL take only `refuse`, `once` or `session`.

#### Scenario: AStrayPrintFlagIsRefused
- **GIVEN** the CLI
- **WHEN** it is given `--json` without `-p`, `-p` with `doctor`, or `--grants always`
- **THEN** each is refused with a message naming the flag
