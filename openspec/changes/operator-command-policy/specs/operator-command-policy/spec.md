## Purpose

Let the operator of a deployment keep slash commands — an extension's setup commands above all — out
of its users' reach, without removing the extension that registered them.

## ADDED Requirements

### Requirement: RefusedCommandsAreNotOffered

The server SHALL leave out of the command list it sends to clients every command whose name matches a
`blockedCommands` pattern, and, when `allowedCommands` is set, every command whose name matches none of
its patterns. Patterns SHALL be globs (`*`, `?`) over the command's name without its slash, matched
without regard to case; `blockedCommands` SHALL win over `allowedCommands`. This SHALL hold for the list
sent when a client connects and for the list sent when extensions bind late.

#### Scenario: BlockedCommandsAreNotOffered
- **GIVEN** an extension registering `setup-creds` and `status`, and `blockedCommands: ["setup*"]`
- **WHEN** a client connects
- **THEN** its command list holds `status` and not `setup-creds`

#### Scenario: AnAllowlistLimitsTheCommands
- **GIVEN** the same extension and `allowedCommands: ["status"]`
- **WHEN** a client connects
- **THEN** its command list is `status` alone

### Requirement: RefusedCommandsDoNotRun

A prompt — new, or the edit of a past message — that invokes a blocked command, or under
`allowedCommands` a registered command it does not name, SHALL be refused before anything runs. A
blocked name SHALL be refused whether or not it is registered; a prompt naming no registered command
SHALL go on as a message under `allowedCommands`. The refusal SHALL not name the command and SHALL
echo nothing.

#### Scenario: ATypedBlockedCommandDoesNotRun
- **GIVEN** `blockedCommands: ["setup*"]` and an extension whose `setup-creds` command leaves a trace when it runs
- **WHEN** the user sends `/setup-creds key=abc`, `/SETUP-creds`, or edits a past message into `/setup-creds`
- **THEN** each is refused with a message that does not name the command, nothing is echoed, and the command leaves no trace

#### Scenario: AMessageBeginningWithASlashIsStillAMessage
- **GIVEN** `allowedCommands: ["status"]`
- **WHEN** the user sends `/tmp is full`
- **THEN** it is not refused as a command

### Requirement: TheExtensionKeepsWorking

Refusing a command SHALL affect only its invocation by users: the extension that registered it SHALL
stay loaded, and its hooks, tools and other commands SHALL run as without the rule.

#### Scenario: TheExtensionKeepsWorking
- **GIVEN** `blockedCommands: ["setup*"]` and an extension with a blocked command, an allowed one and a `session_start` hook
- **WHEN** the session starts and the user sends the allowed command
- **THEN** the hook has run and the allowed command runs

### Requirement: CommandPatternsAreCheckedAtStartup

`blockedCommands` and `allowedCommands` SHALL be arrays of strings. A leading slash SHALL be forgiven;
a pattern that names nothing, or that holds whitespace, SHALL stop the server at startup with the key
and index at fault.

#### Scenario: AnUnusablePatternStopsStartup
- **WHEN** the configuration declares `blockedCommands: ["/"]` or `allowedCommands: ["two words"]`
- **THEN** loading the configuration fails, naming the key and the index
