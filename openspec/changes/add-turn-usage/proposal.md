## Why

The SDK reports what every assistant turn consumed and what the provider charged for it — `input`, `output`, `cacheRead`, `cacheWrite`, `reasoning`, and a `cost` breakdown — and the server throws all of it away. The only usage that reaches the browser today is `ContextUsage`, a *level* (how full the context window is) that exists to drive the compaction button. Nothing tells the user what a session has cost.

That matters in both deployment shapes this project sees. Against a hosted provider, someone is accountable for the spend. Against **self-hosted models — the primary case here — there is no price at all**, and tokens are the only currency: they are what fills the context window, what drives latency, and what a capacity conversation is actually about. Today neither figure is visible.

It is also the missing foundation for a session-analysis view (per-turn cost chart, ranked tool calls, click a point to jump to that turn — the idea worth taking from `pi-livecraft`). That view is out of scope here; without per-turn usage on the wire it cannot be built at all.

## What Changes

- Add a `TurnUsage` data model to the wire protocol: token counters, and a provider-reported cost in USD that is **absent, never zero**, when the provider prices nothing.
- Attach `usage` to the assistant chat item, from both paths that build one: the live `message_end` event and replayed session history. Reopening a session shows the same totals it showed while running.
- Aggregate the turns into a session total in the UI, counting unpriced turns separately from priced ones so a partial answer never reads as an authoritative one.
- Show that total next to the existing context ring in the model bar: **tokens always**, cost additionally when a provider priced anything.

No breaking change: `usage` is optional everywhere, and a client that ignores it behaves exactly as today.

## Capabilities

### New Capabilities
- `session-usage`: what a session has consumed and cost so far — how per-turn figures aggregate, how unpriced turns are reported, and how the total is surfaced in the UI.

### Modified Capabilities
- `model`: the wire-protocol data models gain `TurnUsage`, and the two conversions that produce assistant chat items (`ConvertAssistantMessageToItem`, `ConvertHistoryToItems`) now carry billing counters when the provider reported them.

## Impact

- `shared/src/protocol.ts` — new `TurnUsage` interface; optional `usage` on the assistant `ChatItem`.
- `server/src/convert.ts` — `messageUsage()` extraction, wired into `assistantToItem` and `historyToItems`.
- `ui/src/util/sessionUsage.ts` (new) — aggregate plus cost/token formatting.
- `ui/src/components/ModelBar.tsx` — spend indicator beside the context ring.
- No new dependencies, no server round-trips, no network calls. The data already arrives with each message; this change stops discarding it.
- Out of scope: the session-analysis widget itself, per-tool attribution, and duration measurement.
