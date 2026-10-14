## ADDED Requirements

### Requirement: ScriptCallsBelongToTheirParent

The system SHALL present a script's nested tool calls within the script's own
card, using its renderer. Nested execution events SHALL NOT become independent
model-issued cards. Partial results SHALL carry their rendering while running.
The folded codemode card SHALL show only its compact header. The script, nested
calls and result SHALL remain accessible in its expanded body.

#### Scenario: AScriptsCallsAreNotTheModels

- **WHEN** the model calls codemode and its script reads two files
- **THEN** only the codemode call has an independent card
- **AND** its result lists both reads, including a refused read

#### Scenario: AScriptsCallsShowWhileItRuns

- **WHEN** a codemode script reports a partial result containing its nested calls
- **THEN** the expanded parent card shows those calls before the script finishes

#### Scenario: AScriptsCallsReadTheSameAfterAReload

- **WHEN** a client reconnects after a codemode script finishes
- **THEN** it sees the same single card and rendered list as the live client

#### Scenario: ACodemodeCardStartsCompact

- **WHEN** a codemode card is first displayed or restored after reload
- **THEN** the script, nested calls and output are hidden behind its folded header
- **AND** expanding the card reveals the script and calls with their result
- **AND** streaming updates do not change the user's expanded or folded choice
