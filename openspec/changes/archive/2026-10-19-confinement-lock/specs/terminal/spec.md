## ADDED Requirements

### Requirement: TheTerminalBadgeIsEarned

The terminal's confined badge SHALL be shown closed only when the canary passed for the terminal's
runner, with the terminal's policy; when an attempt got through, the badge SHALL be shown open and
marked as a failure, naming it; while the canary runs, it SHALL say so.

#### Scenario: AnUnverifiedTerminalIsNotCalledConfined
- **GIVEN** `terminal.sandbox` set, a runner that passed its self-check, and a canary that has not finished
- **WHEN** the terminal panel opens
- **THEN** the badge says the confinement is being checked, not that it is confined

#### Scenario: ALeakingTerminalSaysSo
- **GIVEN** `terminal.sandbox` set and a canary that could write beside the root
- **WHEN** the terminal panel opens
- **THEN** the badge is open, marked as a failure, and names the write beside the root
