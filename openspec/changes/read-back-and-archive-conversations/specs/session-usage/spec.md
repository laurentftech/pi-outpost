# Spec Delta

## ADDED Requirements

### Requirement: ASessionThatCannotBePricedStillOpens

A conversation SHALL open whether or not its size in the context window can be established.
Where the runtime cannot compute it — a provider that reports no token counters, a session
file written elsewhere, a compacted branch whose replies carry none — the system SHALL serve
the conversation and leave the context-window indicator silent, rather than failing to
produce the session.

The indicator SHALL claim nothing it cannot compute: an unknown context size is reported as
absent, never as zero or as a stale figure from another turn.

#### Scenario: CompactedSessionWithUnpricedReplies
- **GIVEN** a compacted session whose assistant replies carry no token counters
- **WHEN** a client opens it
- **THEN** the transcript is served, including its compaction boundary, and no error about a missing token count reaches the client

#### Scenario: NoContextFigureIsInvented
- **GIVEN** a session whose context size cannot be established
- **WHEN** the conversation interface is displayed
- **THEN** the context-window indicator is absent rather than showing zero or a figure from another session
