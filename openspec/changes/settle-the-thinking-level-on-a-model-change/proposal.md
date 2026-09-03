## Why

Reported from an office deployment: two models, one that reasons and one that does
not, the default being the reasoning one on `high`. Selecting the other leaves the
control reading `high`, and the slider cannot be moved.

Three faults stack up to that.

1. `set_model` broadcasts `model_changed` — the new model and its accepted levels —
   and nothing else. The level itself is never re-stated, so the client keeps
   showing the level the *previous* model was on.
2. The RPC runtime's mirrored `thinkingLevel` is only written when *it* sets one.
   The child clamps the session's level to the new model inside `set_model`
   (`agent-session.js`: `_getThinkingLevelForModelSwitch` → `setThinkingLevel`) and
   the RPC dialect emits no thinking-level record, so the mirror silently keeps the
   old model's level and the snapshot reports a level the child is not on.
3. Where the accepted set comes from a deployment's `thinkingLevels` declaration,
   nothing clamps at all: the child has never been told about the declaration.

`ModelBar` then finishes the job. A model that accepts one level (`["off"]`) gives a
range with one stop — `max={levels.length - 1}` is `0` — which cannot be dragged
anywhere, while the button still reads the stale `high`.

## What Changes

- On a model change the server **settles** the thinking level: where the level the
  session carries is not one the new model accepts, it is moved to the nearest
  accepted level *below* it (above only when nothing below is offered), through the
  agent rather than only on the wire — and `thinking_changed` states what it settled
  at, whoever did the clamping.
- The RPC runtime re-reads the child's state after `set_model`, so the level it
  reports is the level the child holds.
- `ModelBar` states a one-level model in words instead of drawing an immovable
  slider, and a current level the model does not accept is still named as itself
  rather than quietly redrawn at another stop.

## Capabilities

### New Capabilities

<!-- None. -->

### Modified Capabilities

- `api`: a new requirement — the thinking level follows the model change, and the
  clients are told the level it settled at.
- `pi-rpc-runtime`: a new requirement — the reported thinking level is the child's,
  after a model change the child clamped on its own.
- `components`: a new requirement — a model with a single accepted level is stated,
  not drawn as a range that cannot move.

## Impact

- **Server** — `server/src/index.ts` (`settleThinkingLevel`, called from `set_model`),
  `server/src/rpcRuntime.ts` (re-read `get_state` after `set_model`).
- **Shared** — `shared/src/protocol.ts` gains `clampThinkingLevel`.
- **Client** — `ui/src/components/ModelBar.tsx` (`ThinkingControl`).
- No wire-format change: `thinking_changed` already exists and already means this.
- No change to `set_thinking` validation, to persistence, or to any model whose
  accepted set covers the level in use.
