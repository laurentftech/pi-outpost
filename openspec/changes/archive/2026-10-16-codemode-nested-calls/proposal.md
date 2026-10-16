# Keep script calls inside their parent tool card

## Why

The SDK reports calls made by a script with `parentToolCallId` and persists them
inside the parent's result. Forwarding them as independent model calls creates
extra cards that disappear after reload. Partial results also lose their renderer.

## What Changes

- Keep nested execution events out of independent conversation cards.
- Render the parent tool's partial results and retain its completed rendering on reload.

## Impact

Embedded and RPC event translation, streaming protocol, server rendering and UI updates.
