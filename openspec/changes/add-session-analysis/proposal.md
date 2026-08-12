## Why

`add-turn-usage` put per-turn figures on the wire and a single total in the model bar: `48k tok · $0.31`. That answers "how much so far" and nothing else. It cannot say which turn was expensive, which tool returned 400 kB of noise, which prompt triggered a ten-tool cascade, or where the failures are — the questions someone actually asks when a session feels slow, costly, or stuck.

Every figure needed to answer them is already in the browser. `ChatItem[]` carries per-turn `usage`, tool calls with their arguments, outputs and `isError` flag, and the item order that groups them into request cycles. What is missing is a view that reads that list as a session rather than as a transcript, and — the part that makes it more than a report — links every row back to the message that produced it.

This is the view `add-turn-usage` named as out of scope and made possible.

## What Changes

- Add a **session analysis** panel, opened from the usage indicator in the model bar, derived entirely client-side from the conversation already in memory: no model call, no server round-trip, no new event.
- Summarise the session: token totals split by kind (fresh input, output, cache read, cache write), total and average and median turn cost, turn count, tool-call count, average tools per turn, and failure count.
- Chart **tokens per turn** and **cost per turn** across the session, so a spike is visible rather than inferred.
- Rank **tool calls** by output size, input size, or failure, and summarise **tools by name** with call and failure counts — the two questions differ: one finds the single bad call, the other finds the habitually noisy tool.
- Rank **user requests** by what they cost, grouping each user message with the turns and tool calls it caused.
- Make every chart point and every ranked row **jump to the corresponding message or tool call** in the conversation, highlighting it on arrival. Analysis stays a navigation aid, not a report parked beside the evidence.
- Report empty sections as what is still missing ("no priced turn yet") rather than as zeroes, so absent data never reads as measured data.
- Depends on `session-usage` (change `add-turn-usage`), which supplies the per-turn figures.

No breaking change: the panel is additive, closed by default, and a conversation with no usage at all opens it to explicit empty states.

## Capabilities

### New Capabilities
- `session-analysis`: how the conversation is read as a session — turn and request derivation, tool-call ranking, the figures that are shown and the ones that are honestly withheld, and navigation from a figure back to the message that produced it.

### Modified Capabilities
<!-- None. `session-usage` keeps its requirements unchanged; this change consumes its
     aggregate rather than altering it, and the model-bar indicator gains an opening
     affordance without changing what it displays. -->

## Impact

- `ui/src/util/sessionAnalysis.ts` (new) — `analyzeSession(items)`: turns, requests, tool calls, tool summaries, and the derived statistics, in one linear pass.
- `ui/src/components/SessionAnalysis.tsx` (new) — the panel: summary tiles, hand-rolled inline-SVG charts, ranked tables, ranking controls.
- `ui/src/components/ModelBar.tsx` — the usage indicator becomes the button that opens the panel.
- `ui/src/App.tsx` — panel open state, item anchors (`data-item-index`), and the scroll-and-highlight handler the panel calls.
- No new dependencies: charts are inline SVG, consistent with the existing context ring.
- Out of scope: durations and latency (never observed on this wire, and a replayed session would report them inconsistently), per-tool monetary attribution (costs belong to model requests, not to tools), any model-generated interpretation of the numbers, and export.
