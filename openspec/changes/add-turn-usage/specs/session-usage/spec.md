## Purpose

Reports what a conversation has consumed — tokens first, and cost where a provider prices it — aggregated from per-turn figures, so the person running the session can see consumption without leaving the interface. Self-hosted and gateway-fronted deployments report no price at all, so tokens are the figure this capability guarantees; cost is an extra when it exists.

## ADDED Requirements

### Requirement: SessionUsageAggregate

The system SHALL aggregate the billed figures of every assistant turn in the displayed conversation into a session total covering token counters and cost.

Turns that reported no figures SHALL be excluded from the aggregate entirely rather than counted as zero, because a provider that reports nothing is not the same as a turn that consumed nothing.

#### Scenario: SumsReportedTurns
- **GIVEN** a conversation whose assistant turns each report token counters and a cost
- **WHEN** the session total is computed
- **THEN** it is the sum of those turns, and the number of turns it covers is reported alongside it

#### Scenario: IgnoresTurnsWithoutFigures
- **GIVEN** a conversation containing assistant turns that report no billing figures at all
- **WHEN** the session total is computed
- **THEN** those turns contribute nothing and are not counted among the turns the total covers

#### Scenario: EmptyConversation
- **GIVEN** a conversation with no assistant turn that reported figures
- **WHEN** the session total is computed
- **THEN** every counter is zero and the total covers zero turns

### Requirement: UnpricedTurnsAreReportedSeparately

A turn MAY report token counters without a cost — providers differ, and a local or gateway-fronted endpoint commonly prices nothing. The system SHALL count such turns separately from the monetary total instead of treating them as costing zero.

A cost figure SHALL therefore always be accompanied by the number of turns it does *not* account for, so a partial answer is never presented as an authoritative one.

#### Scenario: TokensWithoutPrice
- **GIVEN** a turn reporting token counters but no cost
- **WHEN** the session total is computed
- **THEN** its tokens are included in the token counters, the monetary total is unchanged, and the turn is counted as unpriced

#### Scenario: MixedProviders
- **GIVEN** a conversation where some turns are priced and others are not
- **WHEN** the session total is displayed
- **THEN** the amount shown is the sum of the priced turns, and the presence of unpriced turns is visible to the user

### Requirement: UsageVisibleDuringTheSession

The system SHALL display the session's token consumption in the conversation interface, alongside the existing context-window indicator, and SHALL keep it current as turns complete.

Tokens are the primary figure and SHALL be shown whenever any turn reported them, independently of whether a price exists — a self-hosted deployment prices nothing and must still see what it consumed. Cost SHALL be shown in addition when at least one turn was priced, and SHALL carry enough precision to stay meaningful when small: an amount below one cent SHALL NOT be rounded to something that reads as zero.

#### Scenario: UpdatesAsTurnsComplete
- **GIVEN** a conversation in progress
- **WHEN** an assistant turn finishes and reports its figures
- **THEN** the displayed session total includes that turn without the user reloading or reopening the session

#### Scenario: TokensWithoutAnyPricing
- **GIVEN** a session against a provider that prices nothing
- **WHEN** the conversation interface is displayed
- **THEN** the token total is shown and no monetary amount is claimed

#### Scenario: SmallAmountsStayLegible
- **GIVEN** a session that has cost a fraction of a cent
- **WHEN** the amount is displayed
- **THEN** it is shown with enough decimal places to distinguish it from zero

#### Scenario: NothingToReport
- **GIVEN** a session where no turn has reported figures
- **WHEN** the conversation interface is displayed
- **THEN** neither tokens nor spend are claimed

### Requirement: UsageSurvivesReopening

A session's reported spend SHALL be derived from the conversation as replayed, not only from turns observed live, so reopening or switching back to a session shows the same total it showed while it was running.

#### Scenario: ReopenedSession
- **GIVEN** a session whose turns reported costs during an earlier run
- **WHEN** the session is reopened
- **THEN** the displayed total matches what it was, without re-running anything
