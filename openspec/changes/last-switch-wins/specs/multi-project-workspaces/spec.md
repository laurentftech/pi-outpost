# Spec Delta

## ADDED Requirements

### Requirement: TheLatestSwitchWins

When a browser asks for several projects in turn, it SHALL end bound to the last one it asked for, whatever
order their starts finish in. This covers switching, opening and side sessions. A project that finishes
starting after the browser has asked for another SHALL NOT bind it, and SHALL stay started. Its failure SHALL
NOT be reported to that browser. Asking for the project already shown while a switch away is in flight SHALL
be sent to the server; with nothing in flight, it SHALL change nothing.

#### Scenario: TheLastSwitchWins
- **WHEN** a browser shown the server's project asks for a cold project, then at once for the server's project again
- **THEN** it ends on the server's project, is never bound to the cold one, its file tree lists the server's project, and the cold project can be switched to afterwards

### Requirement: AProjectsFilesComeBeforeItsAgent

Switching to, or opening, a project whose agent is not running SHALL bind the browser to it as soon as the
project's files can be served, before its agent has started. The client SHALL be told with
`workspace_starting`, whose snapshot names the project, carries `agentStarting: true` and an empty
conversation. Until the agent is ready, the project's file browser, files, git, terminal and project
switching SHALL be served; every other request SHALL be held and handled in order once the agent is ready.
When the agent is ready, the client SHALL receive `workspace_switched` with the full snapshot, and SHALL keep
the file tree and the open file it had for that project. A client that ignores `workspace_starting` SHALL see
what it saw before. If the agent cannot start, a client bound meanwhile SHALL be told why and taken back to
the server's own project, and what it held SHALL be dropped.

#### Scenario: FilesBeforeTheAgent
- **WHEN** a browser switches to a project whose agent takes seconds to start, lists its root and asks for its sessions meanwhile
- **THEN** it is bound with `workspace_starting` within two seconds, the listing is answered before `workspace_switched`, and the sessions request is answered after it

#### Scenario: AFailedStartTakesTheBrowserBack
- **WHEN** the project's directory is gone and its agent cannot start
- **THEN** the browser receives a `workspace_error` saying it could not start, then `workspace_switched` for the server's project, which answers requests
