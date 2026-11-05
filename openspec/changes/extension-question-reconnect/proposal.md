# Preserve unanswered questions across browser disconnection

## Why
Closing the last WebSocket cancels every pending extension question. A browser that loses its
connection during sleep therefore reports a refusal the user never made. A non-streaming extension
command can also lose its question when an unwatched workspace reaches its idle timeout.

## What Changes
- Retain pending extension questions when the last browser disconnects, and replay them on return.
- Keep workspaces awaiting an answer alive beyond their idle retirement period.
- Release blocked questions on deliberate session replacement so an RPC child can process the change.
- Preserve explicit refusal, extension-defined expiry/abort and existing sandbox grant rules.

## Impact
Server connection/lifecycle handling, real-browser and embedded/RPC server regressions,
and extension interaction documentation. No new settings or transport protocol messages.
