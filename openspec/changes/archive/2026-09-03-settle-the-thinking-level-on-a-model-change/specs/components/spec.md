## ADDED Requirements

### Requirement: AModelWithOneLevelIsStatedNotDrawnAsARange

Where the accepted set supplied to `ModelBar` holds a single level, the thinking control
SHALL state that level rather than render a range with one stop. A range whose thumb
cannot move reads as a broken control, not as a fact about the model.

The control SHALL name the level the session holds as itself, even when it is not one of
the stops on offer, rather than redrawing it as the stop it happens to sit at. Settling
that mismatch belongs to the server; until it does, the interface SHALL not claim it has
already happened.

#### Scenario: ASingleAcceptedLevelIsStated
- **GIVEN** `ModelBar` is supplied with an accepted set holding only `off`
- **WHEN** the thinking control is opened
- **THEN** it states that the model accepts `off` only, and offers no range control

#### Scenario: ALevelOutsideTheAcceptedSetIsStillNamed
- **GIVEN** `ModelBar` is supplied with `high` as the current level and an accepted set without it
- **WHEN** the thinking control is opened
- **THEN** the control still reads `high`
