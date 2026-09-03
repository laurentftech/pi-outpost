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
