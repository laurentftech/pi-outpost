# Spec Delta

## ADDED Requirements

### Requirement: HistoryBeforeMessages

The protocol SHALL carry `history_before { requestId, have, count }` (client → server) and its reply
(server → client) echoing the request id and carrying the items, the number of older items that
remain beyond them, and nothing else about other sessions or other sockets.

`have` is the number of pre-context items the requesting client already holds — zero on its first
request — and `count` how many further items it asks for. The server SHALL serve the items
immediately preceding them, in transcript order, from the active branch of the session that client is
watching. It SHALL bound `count` and SHALL answer a larger request with at most that bound, the
reply's remaining count accounting for what it did not send.

The reply SHALL go only to the requesting socket: how far back a reader has scrolled is that
reader's state, not the session's, and a second client watching the same session SHALL NOT have items
prepended because the first one asked.

The snapshot SHALL state how many items precede the ones it carries, so a client knows whether
anything older exists before asking for it, and SHALL mark the items that precede the model's context
as ones the branch-rewriting operations do not accept. A client that ignores both fields SHALL behave
exactly as it does today.

The server SHALL refuse a `history_before` request whose session has changed under it — a switched,
forked or newly compacted session — rather than answering with items from a branch the client is no
longer watching; the snapshot that accompanies such a change already re-establishes the transcript.

A runtime that cannot supply the session branch SHALL answer that the capability is unavailable,
naming the runtime, and SHALL NOT answer with the part of the branch it can reach.

#### Scenario: AnswersTheRequesterOnly
- **GIVEN** two clients watching the same session
- **WHEN** one sends `history_before`
- **THEN** only that client receives the reply, echoing its request id

#### Scenario: ServesThePrecedingItems
- **GIVEN** a compacted session and a client that holds no pre-context items
- **WHEN** it sends `history_before` with `have: 0`
- **THEN** the reply carries the items immediately before the model's context, in transcript order, and states how many older ones remain

#### Scenario: CountIsBounded
- **WHEN** a client sends `history_before` with a `count` above the server's bound
- **THEN** the reply carries at most the bound, and its remaining count reflects the items withheld

#### Scenario: SnapshotSaysWhetherOlderItemsExist
- **WHEN** a client receives a snapshot for a compacted session
- **THEN** the snapshot states how many items precede the ones it carries

#### Scenario: SnapshotMarksReadOnlyItems
- **WHEN** a snapshot or a `history_before` reply carries items from before the model's context
- **THEN** those items are marked as not accepting a prompt edit or a fork

#### Scenario: StaleRequestRefused
- **GIVEN** a client that sends `history_before` for a session the server has since switched or forked
- **WHEN** the request arrives
- **THEN** the server refuses it instead of answering with items from another branch

#### Scenario: UnsupportedRuntimeAnswersUnavailable
- **GIVEN** a deployment whose agent runtime cannot supply the session branch
- **WHEN** a client sends `history_before`
- **THEN** the reply says the capability is unavailable for that runtime, and carries no items
