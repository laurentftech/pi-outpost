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
