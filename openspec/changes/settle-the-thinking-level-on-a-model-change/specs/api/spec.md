## ADDED Requirements

### Requirement: SettleTheThinkingLevelOnAModelChange

When the current model changes, the server SHALL settle the session's thinking level on
the set the new model accepts, and SHALL tell the workspace's clients the level it
settled at.

Where the level the session carries is not in the accepted set, the server SHALL move
the agent to the nearest accepted level below it, and to the nearest above only when no
accepted level lies below. The move SHALL go through the agent, not only onto the wire:
a client showing a level the agent is not on would report an effort the next turn does
not use.

The level SHALL be stated whether or not the server itself moved it. A runtime that
clamps during its own model change reports nothing to the clients that hold the old
level, and a deployment that declares a model's accepted levels narrows a set the
runtime has never been told about.

#### Scenario: ADeclaredNarrowingSettlesTheLevel
- **GIVEN** a configuration declaring that a model accepts only `off`, and a session on `high`
- **WHEN** the client changes to that model
- **THEN** the agent is set to `off` and the client is told the level is `off`

#### Scenario: AnAcceptedLevelSurvivesTheChange
- **GIVEN** a session whose level is on the new model's accepted set
- **WHEN** the model is changed
- **THEN** the level is left untouched and the client is still told what it is

#### Scenario: TheFallbackStepsDownRatherThanUp
- **GIVEN** a session on `high` and a model whose accepted set stops at `low`
- **WHEN** the level is settled on that model
- **THEN** it becomes `low` rather than `off`, and rather than a level above `high`
