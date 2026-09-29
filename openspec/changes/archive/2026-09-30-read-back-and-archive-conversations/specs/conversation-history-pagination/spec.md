# Spec Delta

## Purpose

Lets a reader reach the beginning of a conversation that has been compacted, by serving the part of
the transcript the model can no longer see from the session's own record, and by saying where the
compaction cut so the reader knows what they are looking at.

## ADDED Requirements

### Requirement: OlderTranscriptIsServedOnRequest

The server SHALL be able to answer, for the session a client is watching, with the transcript items
that precede the ones the client holds, taken from the session's active branch — the whole path from
the current leaf to the root, including what compaction removed from the model's context.

Those items SHALL be produced by the same conversion as the live transcript: a recovered message
SHALL render exactly as it rendered when it was live, with the same kind, the same content, the same
tool cards and the same figures.

The items SHALL be returned in transcript order, ending immediately before the oldest item the
client already holds, so that a client appending them above what it has obtains one continuous
conversation with no gap and no repetition. The reply SHALL state how many older items remain
beyond the ones it carries.

The number of items a single request may fetch SHALL be bounded by the server, and a request for
more SHALL be answered with at most that bound rather than refused.

#### Scenario: ServesWhatCompactionRemoved
- **GIVEN** a session that has been compacted, so the transcript the client holds begins after the compaction point
- **WHEN** the client asks for the items before the oldest one it holds
- **THEN** the reply carries the messages from before the compaction point, in the order they were exchanged

#### Scenario: ContinuousWithWhatTheClientHolds
- **GIVEN** a client that already holds one chunk of recovered items
- **WHEN** it asks for the chunk before that one
- **THEN** the items it receives end immediately before the oldest item it holds, repeating none of them and skipping none

#### Scenario: RecoveredItemsMatchLiveRendering
- **GIVEN** a conversation containing a tool call, a workspace image and a diagram, all before the compaction point
- **WHEN** those items are recovered
- **THEN** each arrives as the same kind of item, with the same content, as when it was streamed live

#### Scenario: ReportsWhatRemains
- **WHEN** a request is answered and older items still exist beyond the ones returned
- **THEN** the reply states how many remain, and a reply that exhausts the history states that none remain

#### Scenario: RequestBoundIsClamped
- **WHEN** a client asks for more items than the server's bound
- **THEN** the server answers with at most its bound, and the reply's count of remaining items accounts for the ones it did not send

#### Scenario: AnswersOnlyTheRequester
- **GIVEN** two clients watching the same session
- **WHEN** one asks for older items
- **THEN** only that client receives the reply, and the other client's transcript is unchanged

### Requirement: TheReaderCanAskForOlderMessages

The conversation SHALL offer a control at the top of the transcript whenever older items exist
beyond the ones loaded, and SHALL NOT offer it when the transcript already begins at the
conversation's first message. Activating it SHALL load a further chunk and leave the control present
if more remain.

While a request is in flight the control SHALL show that loading is under way and SHALL NOT issue a
second request for the same chunk. A failed request SHALL leave the transcript as it was and SHALL
report the failure, so that the reader can retry rather than conclude the conversation starts there.

The control SHALL be reachable by keyboard, activable with the standard activation keys, and SHALL
carry an accessible name describing what it loads.

#### Scenario: OfferedWhenOlderItemsExist
- **GIVEN** a compacted session whose transcript begins after the compaction point
- **WHEN** the conversation is displayed
- **THEN** a control to load older messages is present above the first item

#### Scenario: AbsentAtTheBeginning
- **GIVEN** a conversation whose loaded transcript begins at its first message
- **WHEN** the conversation is displayed
- **THEN** no control to load older messages is present

#### Scenario: LoadsAChunkAndStays
- **GIVEN** a conversation with several chunks of older items
- **WHEN** the reader activates the control
- **THEN** the older items appear above the transcript and the control remains, because more remain

#### Scenario: DisappearsAtTheBeginning
- **GIVEN** one chunk of older items remaining
- **WHEN** the reader loads it
- **THEN** the transcript begins at the conversation's first message and the control is gone

#### Scenario: NoDoubleRequest
- **GIVEN** a request in flight
- **WHEN** the reader activates the control again
- **THEN** no second request for the same chunk is issued

#### Scenario: FailureLeavesTheTranscriptIntact
- **GIVEN** a request that fails
- **WHEN** the failure arrives
- **THEN** the transcript is unchanged, the failure is reported, and the control is available again

#### Scenario: KeyboardActivation
- **GIVEN** the control is focused
- **WHEN** the reader presses Enter or Space
- **THEN** the older items load, as if the control had been clicked

### Requirement: LoadingOlderItemsDoesNotMoveTheReader

When older items are inserted above the transcript, the conversation SHALL keep the reader looking
at the same message: the item they were reading SHALL stay where it was on screen rather than being
pushed down by the inserted content.

Loading older items SHALL NOT scroll the conversation to the end, SHALL NOT alter the existing
behaviour that streamed content follows only a reader near the bottom, and SHALL NOT send anything
or change the composer's draft.

#### Scenario: PositionKeptOnInsertAbove
- **GIVEN** a reader scrolled up, reading the oldest item they hold
- **WHEN** a chunk of older items is inserted above it
- **THEN** that item remains at the same position on screen

#### Scenario: DoesNotJumpToTheEnd
- **WHEN** older items are loaded
- **THEN** the conversation does not scroll to the end of the transcript

#### Scenario: StreamingBehaviourUnchanged
- **GIVEN** a reader scrolled up who has loaded older items
- **WHEN** the agent streams new content at the end
- **THEN** the reader's position is unchanged, as it is for a reader who loaded nothing

#### Scenario: SendsNothing
- **GIVEN** a conversation with a draft in the composer
- **WHEN** the reader loads older items
- **THEN** no message is sent, no item is removed, and the draft is unchanged

### Requirement: TheCompactionBoundaryIsVisible

Where compaction cut the conversation, the transcript SHALL show a boundary item that says the
conversation was compacted at that point and carries the summary the model was left with in place of
what came before.

The boundary SHALL be present for any reader of a compacted session, whether or not older items have
been loaded, and SHALL appear in transcript order at the point the compaction happened rather than
at the point loading stopped. A conversation that has never been compacted SHALL show no boundary.

#### Scenario: ShownWithoutLoadingAnything
- **GIVEN** a compacted session opened fresh
- **WHEN** the reader scrolls to the top of the loaded transcript
- **THEN** a boundary saying the conversation was compacted is shown, carrying the retained summary

#### Scenario: PositionedWhereCompactionHappened
- **GIVEN** a reader who has loaded the items from before the compaction point
- **WHEN** the transcript is read in order
- **THEN** the boundary sits between the last recovered item and the first item still in the model's context

#### Scenario: AppearsWhenCompactionRuns
- **GIVEN** a session being watched
- **WHEN** compaction runs
- **THEN** a boundary appears in the transcript at that point, and remains after a reload

#### Scenario: AbsentWithoutCompaction
- **GIVEN** a session that has never been compacted
- **WHEN** the conversation is displayed
- **THEN** no compaction boundary is shown

### Requirement: RecoveredItemsAreReadOnly

Items from before the compaction point SHALL be presented as read-only: the actions that rewrite the
conversation from a message — editing a prompt and forking from a message — SHALL NOT be offered on
them, because the entries they would rewrite are no longer in the model's context.

Everything that only reads SHALL keep working on them: copying, opening a referenced file, enlarging
a figure, and the conversation filters, which SHALL apply to recovered items exactly as they apply to
live ones.

#### Scenario: NoEditOnARecoveredPrompt
- **GIVEN** a recovered user message from before the compaction point
- **WHEN** the reader inspects its available actions
- **THEN** no edit action is offered

#### Scenario: NoForkFromARecoveredMessage
- **GIVEN** a recovered message from before the compaction point
- **WHEN** the reader inspects its available actions
- **THEN** no fork action is offered

#### Scenario: ReadingActionsStillWork
- **GIVEN** a recovered assistant message containing a workspace image and a file link
- **WHEN** the reader copies it, opens the file, and enlarges the image
- **THEN** each works as it does for a live message

#### Scenario: FiltersApplyToRecoveredItems
- **GIVEN** recovered items including tool cards and reasoning
- **WHEN** the reader hides tools, or hides reasoning
- **THEN** the recovered items honour the filter exactly as the live ones do

### Requirement: ARuntimeThatCannotServeTheBranchSaysSo

Reading back depends on the session record the embedded agent runtime keeps. A runtime that cannot
supply the session's branch SHALL report that reading back is unavailable, and the conversation SHALL
NOT offer a control that cannot be honoured. It SHALL NOT present a truncated transcript as
complete.

#### Scenario: NoControlWithoutTheCapability
- **GIVEN** a deployment whose agent runtime cannot supply the session branch
- **WHEN** a compacted conversation is displayed
- **THEN** no control to load older messages is offered

#### Scenario: RequestRefusedNotApproximated
- **GIVEN** such a runtime
- **WHEN** a client asks for older items anyway
- **THEN** the server answers that the capability is unavailable, and does not answer with a partial branch
