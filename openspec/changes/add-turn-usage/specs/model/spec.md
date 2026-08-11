## ADDED Requirements

### Requirement: TurnUsageModel

The wire protocol SHALL define a turn-usage model carrying what one assistant turn consumed — fresh input tokens, output tokens, cache-read tokens, cache-write tokens, a total, and optionally the reasoning tokens counted within the output — together with the provider-reported cost of that turn in USD.

The cost SHALL be optional and SHALL be omitted, never sent as zero, when the provider reports no price. Consumers can then distinguish "this turn was free" from "nobody priced this turn".

This model is distinct from the context-window usage already on the protocol: that one reports how full the window is *now*, while this one reports what a single turn *added*. Only the latter is meaningful to accumulate.

#### Scenario: CarriesCountersAndCost
- **WHEN** a turn's usage is placed on the wire
- **THEN** it carries the token counters and, when the provider priced the turn, the cost in USD

#### Scenario: UnpricedTurnOmitsCost
- **GIVEN** a provider that reports token counters but no price
- **WHEN** that turn's usage is placed on the wire
- **THEN** the cost field is absent rather than zero

## MODIFIED Requirements

### Requirement: ConvertAssistantMessageToItem

The system SHALL convert an assistant message into a chat item.

When the message carries billing counters, the resulting chat item SHALL include the turn's usage. The counters SHALL be accepted only when complete — a turn missing any of its token counters SHALL be reported as having no usage rather than as a partial one, since a partial turn silently skews any total built from it.

#### Scenario: ConvertAssistantMessage
- **GIVEN** An assistant message
- **WHEN** assistantToItem is called
- **THEN** The message is converted to a chat item

#### Scenario: CarriesUsageWhenReported
- **GIVEN** an assistant message whose billing counters are complete
- **WHEN** it is converted to a chat item
- **THEN** the item carries the turn's usage

#### Scenario: OmitsIncompleteUsage
- **GIVEN** an assistant message whose billing counters are missing or malformed
- **WHEN** it is converted to a chat item
- **THEN** the item carries no usage at all

### Requirement: ConvertHistoryToItems

The system SHALL convert session history into an ordered list of chat items, merging each tool result with the tool call that produced it, marking the trailing assistant message as streaming when the conversion is made mid-stream, and attaching the branch's user entry ids from the most recent message backwards.

Assistant items produced from history SHALL carry the same turn usage as items produced live, so a replayed conversation reports the same figures it reported while it ran.

#### Scenario: ConvertIdleHistory
- **GIVEN** A session history and no active stream
- **WHEN** historyToItems is called
- **THEN** All messages are converted to chat items

#### Scenario: ConvertStreamingHistory
- **GIVEN** A session history while the agent is streaming
- **WHEN** historyToItems is called
- **THEN** The trailing in-progress assistant message is not duplicated as a history item

#### Scenario: MergeToolResults
- **GIVEN** A session history containing tool calls and their results
- **WHEN** historyToItems is called
- **THEN** Each tool result is merged with its originating call into a single item

#### Scenario: AttachUserEntryIds
- **GIVEN** A session history and the current branch's user entry ids
- **WHEN** historyToItems is called
- **THEN** Each user item carries its entry id, aligned from the most recent message backwards

#### Scenario: ReplayedTurnsKeepTheirUsage
- **GIVEN** a session history whose assistant messages carry billing counters
- **WHEN** historyToItems is called
- **THEN** the assistant items carry those turns' usage
