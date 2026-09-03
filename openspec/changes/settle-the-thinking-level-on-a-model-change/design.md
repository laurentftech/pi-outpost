## Where the settling belongs

The clamp could live in three places, and only one of them holds for every runtime.

*In the client* — cheapest, and wrong: the client would then show a level the agent
is not on. The next prompt would be answered at the old effort, or at whatever the
provider decided, and the interface would be the only place the lie is invisible.

*In the runtime adapters* — right for the embedded runtime, where the SDK already
clamps and emits `thinking_level_changed`, and impossible for a declaration: a
deployment's `thinkingLevels` entry is a fact the server holds and the child has
never heard of. Two adapters would have to grow the same reconciliation, one of
which cannot do it correctly.

*In the server, on the model-change path* — where `acceptedThinkingLevels` already
reconciles declaration against runtime. That function is the only place that knows
the whole answer, so the settling sits beside it (`settleThinkingLevel`), and the
broadcast is unconditional: the embedded runtime may have clamped on its own during
`setModel`, and the client's held level is then already stale even though the server
changed nothing.

## Which level to fall back to

Downward first: `high` on a model that tops out at `low` becomes `low`, not `off`.
The user asked for as much thinking as they could get, and the nearest honest answer
below is the one that keeps that intent. Stepping *up* to the nearest accepted level
would spend more than was asked for — a real cost on a per-token deployment — so it
happens only when nothing below is offered at all (`minimal` on a model whose scale
starts at `high`).

pi's own `clampThinkingLevel` searches upward first. The two agree wherever the
runtime is the one narrowing the set — the levels below a requested one are always
present in a model-derived scale, so both land on the same stop — and ours only ever
decides the cases pi never sees: sets narrowed by a deployment's declaration.

## Why the RPC mirror needs its own read

`RpcRuntime` keeps `thinkingLevel` as a field because the dialect has no state push:
the child answers `get_state` and emits records for a turn, and nothing in between.
`set_thinking_level` is therefore the only thing that writes the field — until a
model change, where the child clamps internally and reports nothing. One extra
`get_state` after `set_model` closes it, on the path that already pays for a
`get_available_thinking_levels` round trip.

The fake child in `server/test/fixtures/fake-pi-rpc.mjs` gained the same clamp, so
the test exercises the divergence rather than a fake that never diverges.

## What the control says when there is nothing to choose

A range input with one stop reads as a broken control: the thumb sits at the left
and does not move, and nothing on screen says why. The popover states the fact
instead — "this model accepts `off` only" — which is the same information the slider
was failing to convey. Above one stop nothing changes.
