## Context

See proposal.md — Why.

Three constraints shape the approach:

- The data already arrives. `pi-ai`'s `Usage` rides on every finished assistant message (`input`, `output`, `cacheRead`, `cacheWrite`, `cacheWrite1h?`, `reasoning?`, `totalTokens`, `cost{input,output,cacheRead,cacheWrite,total}`). Nothing needs fetching, and no round-trip is added.
- Assistant chat items are built in **two** places: live, from the `message_end` event, and on replay, from session history. Both run through `server/src/convert.ts`.
- The protocol already carries a similarly named but unrelated concept — `ContextUsage`, a level, feeding the compaction button. The two must not be conflated.

## Goals / Non-Goals

**Goals**
- Per-turn figures reach the browser and survive session replay.
- A session total that never overstates its own authority.
- Full usefulness with no pricing whatsoever: on self-hosted models, tokens carry the entire value of this change.

**Non-Goals**
- The session-analysis widget (charts, ranked tool calls, click-to-jump). This change is its precondition, not its delivery.
- Per-tool cost attribution. Costs belong to model requests; tools have sizes and durations, not prices.
- Duration measurement, which is only observable live and would make replayed sessions inconsistent.
- Reconciling against the SDK's own session totals. Deferred until there is a view that shows both.

## Decisions

**Attach usage to the assistant item, not to a separate event.**
The alternative — a `turn_usage` message keyed by turn id — would need an identifier the protocol does not currently carry on assistant items, and would let the two streams diverge (an item without its usage, or usage without its item). Carrying it on the item makes replay work for free: the same field, from the same converter, on both paths. The cost is that the aggregate is recomputed from the item list rather than accumulated incrementally; at conversation sizes this is a sum over a few hundred entries.

**Cost is optional and omitted, never zero — and "no price" is detected from an all-zero breakdown.**
The SDK does not pass a provider's price through; it computes one from the model's own rates and always fills `cost.total`. A model with no rates — the self-hosted case — therefore reports `0`, not nothing. Reading that field alone would put a measured-looking `$0.00` in front of exactly the deployment that has no bill, so a turn counts as priced only when some component of the breakdown exceeds zero. A turn genuinely charged nothing is then reported unpriced, which says the same thing about the money without claiming to have measured it.

A provider that reports no price is not a provider reporting a price of zero. Collapsing the two makes a total look authoritative when it is not — the failure mode is silent and always in the direction of understating the bill. The aggregate therefore carries `unpriced` alongside `cost`, and the UI can say "$0.42 · 2 unpriced" rather than "$0.42".

**Tokens are the primary figure, cost the conditional one.**
Self-hosted deployments — the main target here — price nothing, so a cost-first design degrades to showing nothing at all on the very setup that most needs the numbers. Tokens are always present when a turn reported anything, so the bar leads with them and appends cost only when some turn was priced. This also settles what the indicator shows when *every* turn is unpriced: tokens, not an empty slot.

**Extraction is all-or-nothing per turn.**
A turn is reported only when all four token counters are present and finite. The alternative, defaulting missing counters to zero, produces a turn that looks complete and quietly skews every total built on it. A dropped turn is visible in the turn count; a zeroed one is not.

**`totalTokens` is derived when absent.**
The SDK provides it, but it is the one field that can be reconstructed (`input + output + cacheRead + cacheWrite`) without inventing information, so a provider that omits it still yields a usable turn.

**The aggregate lives in the UI, not the server.**
It is a pure function of the item list the client already holds. Computing it server-side would mean recomputing and rebroadcasting on every turn, for a figure the client can derive. It also keeps the server free of a presentation concern.

## Risks / Trade-offs

- **Cost figures come from the provider and may be wrong or missing** → Never presented as computed or verified; the count of unpriced turns is displayed beside the amount so partial data announces itself.
- **`reasoning` is a subset of `output`, and `cacheWrite1h` a subset of `cacheWrite`** → Only `reasoning` is carried, and it is documented as a subset so no consumer double-counts it into a total. `cacheWrite1h` is dropped: it is Anthropic-only and has no consumer here.
- **Recomputing the aggregate on each render** → It is O(items) over a list already in memory, with no allocation per turn beyond the accumulator. If a conversation ever grows large enough for this to matter, memoisation is local to one component.
- **Adding a field to the hottest path on the wire** → The field is optional, small, and set once per assistant turn — not per delta. Streaming traffic is unchanged.

## Migration Plan

No migration. `usage` is optional on an existing item type: an older client ignores an unknown field, and a newer client treats its absence exactly as it treats today's every-turn absence. Nothing persists it, so there is no stored shape to upgrade. Reverting is deleting the field.

## Open Questions

None. The one that stood here — whether tokens or cost lead the model bar — is settled above: tokens lead, because the primary deployment prices nothing.
