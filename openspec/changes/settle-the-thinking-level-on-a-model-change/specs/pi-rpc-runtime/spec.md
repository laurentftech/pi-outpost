## ADDED Requirements

### Requirement: TheReportedThinkingLevelFollowsTheChild

The RPC runtime SHALL report the thinking level the child actually holds, including
after a model change the child clamped on its own.

The dialect pushes no thinking-level record, so a level the runtime did not set is
invisible until it is asked for: the runtime SHALL re-read the child's state after a
`set_model`, alongside the accepted levels it already refreshes there.

#### Scenario: AClampedLevelIsReReadAfterAModelChange
- **GIVEN** a child on `high` and a model change to one that accepts only `off`
- **WHEN** the runtime changes the model
- **THEN** its snapshot reports `off`, the level the child clamped to

### Requirement: AModelKeepsItsReportedCapabilitiesAcrossASelection

The RPC runtime SHALL report a model's `reasoning` capability after a selection even where
the child's `set_model` answer does not repeat it, taking it from the catalog it already
holds.

Whether a model reasons decides whether a thinking control exists at all. It is a property
of the model, not of the answer to one command, and a dialect that answers `set_model`
with nothing SHALL NOT cost a reasoning model its control.

#### Scenario: ASilentSetModelAnswerKeepsTheCatalogsCapability
- **GIVEN** a catalog listing a model as reasoning, and a child answering `set_model` with no model
- **WHEN** the runtime changes to that model
- **THEN** it still reports the model as reasoning
