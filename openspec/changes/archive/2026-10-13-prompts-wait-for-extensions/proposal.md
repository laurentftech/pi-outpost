# Proposal

## Why

The embedded runtime shows the session before its extensions have finished starting: pi runs every
extension's `session_start` in turn, and startup waited at most five seconds for them. A message sent
in that window ran at once, before the extensions that had not started yet. pi-landstrip restores the
rules it applies to every tool call in `session_start`, and its `tool_call` guard skips the check
until then — so a turn run in that window escaped the sandbox's rules. Shortening the grace, to start
faster, would have widened the window.

## What Changes

- **A prompt waits for the extensions to finish starting.** The server holds a message sent while
  they start, and runs it once they have; extension `/` commands too.
- **The wait is visible and can be cancelled.** The greeting says the extensions are still starting;
  the held message reads "waiting for extensions to start…" with a cancel button. Cancelling (or
  abort) releases the message unsent, with an error saying why; cancel puts its text back in an
  empty composer.
- **Startup waits one second for the extensions instead of five**, since nothing can run before them
  any more.

## Capabilities

### New Capabilities

- `extension-startup`: `APromptWaitsForTheExtensions`, `AWaitingPromptCanBeCancelled`.

## Impact

- `server/src/embeddedRuntime.ts`, `server/src/agentRuntime.ts`, `server/src/index.ts`,
  `shared/src/protocol.ts` (`SessionSnapshot.extensionsBinding`), `ui/src/useAgent.ts`,
  `ui/src/App.tsx`.
- Embedded runtime only. The RPC runtime is pi's own process, which binds its extensions before it
  reads a command.
