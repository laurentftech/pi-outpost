# Spec Delta

## ADDED Requirements

### Requirement: ARepositorysConfigurationRunsNothingInTheServer

The workspace Git integration runs git unconfined, in projects whose `.git/config` the agent's confined commands can write. It SHALL run git so that no command named by the repository's configuration, or a file it includes, runs: those keys SHALL be overridden by configuration given in the environment, and `log` and `show` SHALL pass `--no-textconv` and `--no-ext-diff`.

#### Scenario: ARepositorysConfigurationRunsNothingInTheServer
- **GIVEN** a repository whose `.git/config` (or a file it includes) names a command as `core.fsmonitor`, a diff driver's `textconv` or `command`, `diff.external`, or a filter's `clean` or `process`, with `.gitattributes` assigning the driver and a tracked file changed at the same size
- **WHEN** the server runs every git call it makes: status, log, a file's log, show, and a file's content at HEAD and at a revision
- **THEN** none of those commands ran
- **AND** under MXC's real executor, a confined command that cannot write outside its root writes `core.fsmonitor` into `.git/config`, and the server's status does not run it
