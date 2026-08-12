## Purpose

Reads a conversation as a session rather than as a transcript: which turns were expensive, which tool calls were large or failed, which requests drove the spend — and links every figure back to the message that produced it, so an observation becomes a place in the conversation. Derived from what the interface already holds, so it costs no model call and works on a session opened after the fact.

## ADDED Requirements

### Requirement: SessionIsDerivedFromTheConversation

The system SHALL derive the analysis from the conversation the interface already displays, without calling a model, contacting the server, or persisting anything.

The analysis SHALL reflect the conversation as currently displayed: a turn that completes while the analysis is open SHALL be included without the user reopening it.

#### Scenario: NoExternalWork
- **GIVEN** a conversation with completed turns and tool calls
- **WHEN** the analysis is opened
- **THEN** it is produced from the displayed conversation alone, with no model call and no additional server request

#### Scenario: FollowsTheLiveConversation
- **GIVEN** the analysis is open while the agent is answering
- **WHEN** a turn completes and reports its figures
- **THEN** the analysis includes that turn without being reopened

#### Scenario: ReplayedSession
- **GIVEN** a session reopened from history
- **WHEN** the analysis is opened
- **THEN** it reports the same turns, tool calls and totals it would have reported while the session ran

### Requirement: TurnAndRequestDerivation

The system SHALL group the conversation into **turns** — assistant messages that reported figures — and into **requests** — a user message together with every turn and tool call that followed it, up to the next user message.

Each turn SHALL carry its own token counters and, where the provider priced it, its cost. Each request SHALL carry the sum of its turns, the tool calls it triggered, and how many of those failed.

Assistant messages that reported no figures SHALL NOT be counted as turns, and tool calls that precede any user message SHALL still be attributed to the session rather than dropped.

#### Scenario: TurnsAreNumbered
- **GIVEN** a conversation with several assistant turns reporting figures
- **WHEN** the analysis is produced
- **THEN** each turn appears once, in conversation order, identified by its position in the session

#### Scenario: RequestGroupsItsConsequences
- **GIVEN** a user message followed by two assistant turns and four tool calls, then another user message
- **WHEN** the analysis is produced
- **THEN** the first request reports two turns and four tool calls, and the second request reports only what followed it

#### Scenario: UnreportedTurnsAreNotCounted
- **GIVEN** an assistant message carrying no figures, such as one still streaming
- **WHEN** the analysis is produced
- **THEN** it is not counted as a turn and contributes nothing to any total

### Requirement: SessionStatistics

The system SHALL report, for the session as a whole: total tokens split into fresh input, output, cache read and cache write; the number of turns; the total, average and median cost across the turns that carried a price; the number of tool calls; the average number of tool calls per turn; and the number of tool calls that failed.

Cost statistics SHALL be computed over priced turns only, and the number of unpriced turns SHALL be shown alongside them, so an average is never presented as covering turns it excludes.

#### Scenario: TokensSplitByKind
- **GIVEN** a session whose turns reported all four token counters
- **WHEN** the analysis is displayed
- **THEN** fresh input, output, cache read and cache write are reported separately, not only as one total

#### Scenario: AverageAndMedianOverPricedTurns
- **GIVEN** a session where five turns are priced and two are not
- **WHEN** the cost statistics are displayed
- **THEN** the average and median are computed over the five priced turns and the two unpriced turns are reported alongside

#### Scenario: FailureCount
- **GIVEN** a session in which three tool calls returned an error
- **WHEN** the analysis is displayed
- **THEN** it reports three failed tool calls out of the total number of tool calls

### Requirement: PerTurnCharts

The system SHALL chart token consumption and cost across the session's turns, in conversation order, so an outlier is visible rather than inferred.

The token chart SHALL distinguish the token kinds it plots. The cost chart SHALL be shown only when at least one turn was priced.

A point on either chart SHALL identify which turn it represents and what that turn consumed.

#### Scenario: TokenSeriesAcrossTurns
- **GIVEN** a session with several turns
- **WHEN** the token chart is displayed
- **THEN** each turn appears at its position in the session, and the plotted token kinds are distinguishable from one another

#### Scenario: NoCostChartWithoutPrices
- **GIVEN** a session against a provider that prices nothing
- **WHEN** the analysis is displayed
- **THEN** no cost chart is drawn and the absence of pricing is stated rather than plotted as zero

#### Scenario: PointIdentifiesItsTurn
- **GIVEN** a token or cost chart
- **WHEN** a point is inspected
- **THEN** it reports which turn it belongs to and that turn's figures

### Requirement: ToolCallRanking

The system SHALL rank individual tool calls, and SHALL let the ranking criterion be chosen between output size, input size, and failure.

Sizes SHALL be reported as the size of the serialized arguments and of the raw output — measured content, not provider tokens — and SHALL NOT be presented as a monetary cost, because costs belong to model requests and not to tool calls.

The system SHALL additionally summarise tool calls **by tool name**, reporting call count, failure count, and accumulated input and output size, because the noisiest single call and the habitually noisy tool are different findings.

#### Scenario: RankedByOutputSize
- **GIVEN** a session whose tool calls returned outputs of differing sizes
- **WHEN** the ranking criterion is output size
- **THEN** the largest outputs are listed first, each with its tool name and measured size

#### Scenario: RankedByFailure
- **GIVEN** a session containing failed tool calls
- **WHEN** the ranking criterion is failure
- **THEN** the failed calls are listed first and identified as failures

#### Scenario: PerToolSummary
- **GIVEN** a session that called the same tool eleven times, twice with an error
- **WHEN** the per-tool summary is displayed
- **THEN** that tool appears once, reporting eleven calls, two failures, and its accumulated input and output size

#### Scenario: SizesAreNotCosts
- **GIVEN** any tool call ranking
- **WHEN** it is displayed
- **THEN** sizes are labelled as measured content size and no monetary amount is attributed to a tool call

### Requirement: CostliestRequests

The system SHALL rank the session's requests by what they consumed, identifying each by its user message, and reporting its tokens, its cost where priced, the number of turns it took and the number of tool calls it triggered.

#### Scenario: RequestsRankedByConsumption
- **GIVEN** a session with several user requests of differing weight
- **WHEN** the request ranking is displayed
- **THEN** the heaviest requests are listed first, each identified by a recognisable excerpt of its user message

#### Scenario: RequestReportsItsShape
- **GIVEN** a request that took three turns and nine tool calls
- **WHEN** it appears in the ranking
- **THEN** it reports those counts alongside its tokens and, where priced, its cost

### Requirement: NavigationBackToTheConversation

Every chart point, ranked tool call, and ranked request SHALL navigate to the message or tool call it describes: the conversation SHALL scroll to that item and SHALL mark it briefly on arrival, so the target is identifiable among its neighbours.

Navigation SHALL NOT modify the conversation, and SHALL reach a target that the conversation is currently not displaying rather than failing silently.

#### Scenario: JumpToATurn
- **GIVEN** the analysis is open and a chart point is selected
- **WHEN** the user activates it
- **THEN** the conversation scrolls to that assistant message and marks it briefly

#### Scenario: JumpToAToolCall
- **GIVEN** a ranked tool call
- **WHEN** the user activates its row
- **THEN** the conversation scrolls to that tool call and marks it briefly

#### Scenario: TargetCurrentlyHidden
- **GIVEN** the conversation is configured to hide tool calls
- **WHEN** the user activates a ranked tool call
- **THEN** the target is made visible before the conversation scrolls to it, rather than the activation doing nothing

#### Scenario: NavigationIsReadOnly
- **GIVEN** any navigation from the analysis
- **WHEN** it completes
- **THEN** the conversation's content is unchanged — nothing is sent, edited, or re-run

### Requirement: MissingDataIsNamedNotZeroed

Where a section has nothing to report, the system SHALL state what activity is still missing instead of displaying zeroes, so absent data is never read as measured data.

#### Scenario: NoToolCallsYet
- **GIVEN** a session in which no tool has been called
- **WHEN** the tool sections are displayed
- **THEN** they state that no tool call has been recorded rather than showing a ranking of zeroes

#### Scenario: NoPricedTurn
- **GIVEN** a session whose turns reported tokens but no price
- **WHEN** the cost statistics are displayed
- **THEN** they state that no turn was priced, and the token statistics are shown in full

#### Scenario: EmptyConversation
- **GIVEN** a session with no assistant turn and no tool call
- **WHEN** the analysis is opened
- **THEN** it explains that there is nothing to analyse yet and claims no figures

### Requirement: AnalysisIsOpenedFromTheUsageIndicator

The session's usage indicator SHALL open the analysis, and the analysis SHALL be closable by the user and closed by default.

While the analysis is open, the conversation SHALL remain usable, so a jump lands on a visible message rather than behind the analysis.

#### Scenario: OpenedFromTheIndicator
- **GIVEN** a session whose usage indicator is displayed
- **WHEN** the user activates the indicator
- **THEN** the session analysis opens

#### Scenario: ClosedByDefault
- **GIVEN** a freshly loaded session
- **WHEN** the interface is displayed
- **THEN** the analysis is not shown until the user asks for it

#### Scenario: ConversationStaysReachable
- **GIVEN** the analysis is open on a wide display
- **WHEN** the user jumps to a turn
- **THEN** the conversation is visible and scrolled to that turn
