# Proposal

## Why

A new session binds its extensions before the server announces the replacement, and an extension
may ask the user something in `session_start` (openlore asks for its configuration). The question
reached the client first; the `session_replaced` snapshot that followed wiped it, as every snapshot
wipes a client's dialogs. The binding — and any message held for it — then waited on an answer
nobody could see: "waiting for extensions to start…" for as long as the question stayed open.
Found live, with "+ new" clicked while the user's own extensions were loading.

## What Changes

- After announcing a replaced session, the server sends again every question still pending, as it
  already does to a client that connects.
- The replaced session's questions, cancelled when it is replaced, are forgotten then (a runtime
  event, `dialogs_cancelled`), so only the new session's are sent again.

## Capabilities

### Modified Capabilities

- `extension-startup`: `AQuestionAskedWhileASessionStartsIsShown` is added.

## Impact

- `server/src/agentRuntime.ts` (event), `server/src/embeddedRuntime.ts`, `server/src/index.ts`.
- No protocol change: clients receive the same `extension_ui_request` messages, after the snapshot.
