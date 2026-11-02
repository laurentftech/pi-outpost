## MODIFIED Requirements

### Requirement: UserEntryBroadcast

Once a turn is persisted, the server SHALL broadcast the current branch's user messages as `{entryId, text}` pairs, oldest first. The client SHALL pair them onto its user items from the most recent backwards and SHALL stop at the first text mismatch, leaving the remaining items without an entry id.

This is required because the optimistic user echo and the persisted entries are not one-to-one: an extension slash command, or an extension `input` handler that consumes the message, echoes a chat bubble that never becomes a session entry. A prompt queued behind a running turn is echoed only when the agent receives it, so a queued prompt that is removed or stays queued produces no such bubble. Position-only alignment would shift every earlier bubble onto the previous message's entry, and an edit would then rewind the wrong turn.

#### Scenario: PairAfterTurn
- **GIVEN** a client that echoed a user bubble optimistically
- **WHEN** the turn is persisted and user_entries arrives
- **THEN** the bubble carries its entry id and becomes editable

#### Scenario: PhantomBubbleFailsClosed
- **GIVEN** a chat bubble that never became a session entry
- **WHEN** user_entries arrives
- **THEN** pairing stops at that bubble: it carries no entry id, and no earlier bubble is paired with another message's entry
