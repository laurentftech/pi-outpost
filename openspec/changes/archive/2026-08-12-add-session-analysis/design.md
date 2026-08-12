## Context

See proposal.md — Why.

Four properties of this codebase shape the design:

- The conversation is a **flat `ChatItem[]`** held in `useAgent` state: `user`, `assistant` (with optional `usage`), `tool` (with `toolName`, `args`, `output`, `isError`, `running`), `custom`. Structure — which turns answered which request, which tool calls a turn issued — is carried by *order*, not by references.
- Only `tool` items have an identifier (`toolCallId`). User and assistant items have none; `App.tsx` already keys them by array index (`${sessionId}:${i}`).
- Nothing on the wire carries timestamps or durations, and the server does not send session totals. What the analysis can report is exactly what the items carry.
- The UI has no charting dependency and one hand-rolled SVG precedent: `ContextRing` in `ModelBar.tsx`.

`sessionUsage()` (from `add-turn-usage`) already aggregates the turn figures for the model bar.

## Goals / Non-Goals

**Goals**
- One linear derivation producing every figure the panel shows, testable without React.
- Navigation targets that survive the panel being open while the conversation grows.
- Zero new dependencies and no server change.

**Non-Goals**
- A general charting abstraction. Two chart shapes are needed; a reusable chart layer is not.
- Reconciling against provider-side session totals — the server does not send them.
- Persisting the analysis, or its ranking choices, across sessions.
- Any measurement the wire does not carry (durations, latency, queue time).

## Decisions

**The item index is the navigation identity.**
A target is `{ kind: "item", index }` — the item's position in `state.items`. Tool calls also carry `toolCallId`, but using it for tools and indices for turns would mean two lookup paths for one gesture. The alternative — adding stable ids to the protocol for user and assistant items — is wire churn for a purely local concern, and would have to survive replay, where ids would have to be invented anyway. Indices are stable within a rendered conversation and are already what React keys use; a session switch replaces the whole list and closes nothing but a stale panel, since `analyzeSession` re-runs on the new list.

**The derivation is a pure function over the item list, in one pass.**
`analyzeSession(items): SessionAnalysis` walks the list once, opening a request at each `user` item, attributing each assistant turn and tool call to the open request, then computing totals, the median, and the rankings from the collected arrays. Rankings are produced by sorting copies, not by re-walking. This keeps the whole surface unit-testable with plain arrays — no rendering, no mocks — which is where the interesting cases live (a tool call before any user message, an unpriced turn, a still-streaming assistant item).

**Session totals come from `sessionUsage()`, not from a second accumulator.**
The panel and the model bar must agree to the token. `analyzeSession` calls the existing aggregate for the session-wide counters and adds only what the panel needs beyond it: per-turn records, requests, tool statistics, average and median. Two independent accumulators over the same items would drift the moment either changed.

**Tool calls before the first user message are attributed to a synthetic leading request.**
A replayed session can begin with tool activity (a resumed run, a compaction artefact). Dropping those calls would make the tool totals disagree with the tool cards on screen. They are collected into a request with no user message, labelled as such, and excluded from the "costliest requests" ranking where it would have no title to show.

**Tool sizes are character counts of serialized arguments and raw output, labelled as sizes.**
`JSON.stringify(args).length` and `output.length`. They rank reliably — a 400 kB output is the outlier whatever the unit — while pretending they are tokens would invent a conversion the provider never reported. Byte length via `TextEncoder` was considered and rejected: it allocates per call for a figure used only for ordering. The UI labels the column *size*, never *cost*.

**A turn is an assistant item with `usage`; a request's tool calls include the running ones.**
A streaming assistant item has no `usage` yet and is not a turn — counting it would put a zero in the middle of the chart. A `running` tool call, by contrast, is real and visible; it counts toward the tool total and is marked pending rather than failed. Failure is `isError === true` only, never "no output".

**Charts are hand-rolled inline SVG with a fixed per-turn spacing and a horizontal scroll.**
A charting library would be the largest dependency in the UI for two plots. Fixed spacing (rather than fitting N turns into the available width) keeps a 200-turn session readable by scrolling instead of collapsing into a solid band; the y-axis stays pinned outside the scrolled area. The token chart plots one line per token kind on a shared scale; the cost chart is a single series and renders only when some turn was priced.

**The panel is a right-hand drawer over the conversation area, not a full-screen view.**
The spec requires that a jump land on a visible message. A drawer over the right side of the main region (the conversation keeps the remaining width) satisfies that on a wide display without a layout rewrite. Below a narrow breakpoint the drawer takes the full width and a jump closes it, because splitting a phone-width screen would leave neither side legible. `FileViewer`'s pattern — an overlay inside the `z-0` container, below the header's menus — is reused so the header's popovers keep working.

**Jumping to a hidden tool call turns tool display back on.**
The conversation has a `hideTools` toggle. Scrolling to an item that is not rendered would be a silent no-op — the worst outcome for a navigation affordance. Activating a tool row therefore clears `hideTools` before scrolling. The trade-off is that a navigation gesture changes a display preference; it is visible, immediately reversible, and preferable to a dead click. Scrolling to the parent turn instead was rejected: it lands the user next to the evidence rather than on it.

**Arrival is marked by a transient highlight, not a selection.**
`App.tsx` holds a `highlightIndex` cleared by a timeout. The item's wrapper carries `data-item-index` for `scrollIntoView` and a ring class while highlighted. Persisting the selection would add a state the conversation must then clear on every unrelated interaction.

**The analysis is computed only while the panel is open.**
`useMemo` over `[items, open]`, returning early when closed. The walk is linear, but the sorts and the per-tool grouping are not free on a long session, and the panel is closed almost all of the time.

## Risks / Trade-offs

- **Index-based targets break if the item list is ever mutated in place rather than replaced** → The reducer in `useAgent` replaces the array on every change; the analysis re-derives from the same list it navigates, so both sides always share one indexing.
- **A long session makes the chart wide** → Fixed spacing plus horizontal scroll, with the axis pinned; no attempt to fit an unbounded number of turns into a fixed width.
- **`JSON.stringify(args)` can throw on a cyclic or non-serialisable argument** → The size helper catches and falls back to zero rather than taking the panel down with it; a size of zero orders the call last, which is the honest place for a call whose size could not be measured.
- **`hideTools` being toggled by a jump surprises the user** → It is the only outcome that honours the click, and the toggle remains where it was, one click away.
- **The panel duplicates figures the model bar shows** → Intentional: the bar is the glance, the panel the breakdown. They are computed from one aggregate so they cannot disagree.
- **Empty states multiply** (no tools, no prices, nothing at all) → They are the requirement, not an edge case: each section renders its own explanation, which is cheaper than one global "no data" screen that hides the sections that *do* have data.

## Migration Plan

None. The panel is additive and closed by default; removing it is deleting two files and the props that reach them. No stored state, no wire change, no server change.

## Open Questions

None.
