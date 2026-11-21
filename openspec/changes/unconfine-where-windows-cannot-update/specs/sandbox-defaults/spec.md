# Spec Delta

## ADDED Requirements

### Requirement: UnconfiningIsOneCommand

`pi-outpost config --unconfine` SHALL set `"sandbox.bashRunner": "none"` in the configuration file and
change nothing else, keeping the file's layout. It SHALL print the change, what an unconfined command
may then do, and `pi-outpost config --confine` as the way back. Where there is nothing to loosen — no
shell, the extension's shell, a shell already unconfined, `"sandbox": false` — it SHALL leave the file
byte for byte as it was and say why. It SHALL NOT be offered as a switch in the interface.

#### Scenario: UnconfiningIsOneCommandThatSaysWhatItCosts
- **GIVEN** a configuration file whose `sandbox.bashRunner` is `"auto"`
- **WHEN** the user runs `pi-outpost config --unconfine`
- **THEN** the file holds `"bashRunner": "none"`, its other keys, indentation and line endings unchanged, and the command prints the change, that commands then run with every right of the user's account, and `pi-outpost config --confine` to confine again

### Requirement: TheWaysOutAreSideBySide

Where the agent's shell is unavailable because this machine cannot confine it, the dialog SHALL give the
ways out side by side: updating Windows, when that is the cause, and running commands unconfined with
`pi-outpost config --unconfine`, with what that costs. A Windows before 24H2 SHALL be told it must move
to 24H2 or later, not to install a cumulative update. The wording SHALL NOT presume who decides about
the machine's updates.

#### Scenario: AWindowsBefore24H2IsToldBothWays
- **GIVEN** Windows 11 23H2 (build 22631), `allowBash` and `bashRunner: "auto"`
- **WHEN** the interface opens
- **THEN** the dialog names the build and "Windows 11 24H2 or later, with the August 2026 cumulative update", says to update Windows to build 26100.9278 or later, and, beside it, "If you cannot update Windows, run commands unconfined" with `pi-outpost config --unconfine` and its cost
