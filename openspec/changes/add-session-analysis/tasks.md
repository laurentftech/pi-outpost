## 1. Derivation

- [x] 1.1 Add `ui/src/util/sessionAnalysis.ts` with the shapes the panel consumes: `AnalyzedTurn` (item index, turn number, token counters, optional cost), `AnalyzedToolCall` (item index, `toolCallId`, name, input/output size, `isError`, `running`, owning request index), `AnalyzedRequest` (item index, title excerpt, turn count, tool-call count, failure count, token counters, optional cost), `ToolSummary` (name, calls, failures, accumulated input/output size), and `SessionAnalysis` holding them plus the session statistics
- [x] 1.2 Implement `analyzeSession(items)` as one linear pass: open a request at each `user` item, attribute assistant turns (only those carrying `usage`) and tool calls to the open request, and collect tool calls preceding the first user message into a leading request with no title
- [x] 1.3 Take the session-wide counters from the existing `sessionUsage(items)` rather than accumulating them a second time, so the panel and the model bar cannot disagree
- [x] 1.4 Compute the cost statistics over priced turns only — total, average, median (mean of the two middles on an even count) — and carry the unpriced turn count alongside them
- [x] 1.5 Compute the tool statistics: total calls, failures (`isError === true` only), average calls per turn, and the per-name summary
- [x] 1.6 Add the size helper: `JSON.stringify(args).length` for input and `output.length` for output, catching a non-serialisable argument and returning zero rather than throwing
- [x] 1.7 Add the rankings: tool calls by output size, by input size, and by failure; requests by tokens (and by cost where priced), excluding the untitled leading request from the request ranking
- [x] 1.8 Unit-test `analyzeSession` in `ui/src/util/sessionAnalysis.test.ts`: turn numbering and request grouping, a streaming assistant item excluded, a running tool call counted but not failed, a tool call before any user message, priced/unpriced/mixed sessions, median on odd and even counts, per-tool accumulation, a cyclic tool argument, and an empty conversation

## 2. Navigation plumbing

- [x] 2.1 In `ui/src/App.tsx`, wrap each rendered item so it carries `data-item-index={i}`, without disturbing the existing keying or the `hideTools` skip
- [x] 2.2 Add a `jumpToItem(index)` handler: clear `hideTools` when the target is a tool call, scroll the item into view within the conversation scroller, and set a `highlightIndex` cleared by a timeout
- [x] 2.3 Render the highlight as a transient ring on the targeted item, and make sure a jump does not fight the existing stick-to-bottom auto-scroll
- [x] 2.4 Component-test that activating a target scrolls to the matching item, that a hidden tool call is revealed first, and that the highlight clears on its own

## 3. Panel

- [x] 3.1 Add `ui/src/components/SessionAnalysis.tsx`: a right-hand drawer inside the conversation area's `z-0` container, with a close control, full-width below the narrow breakpoint where a jump also closes it
- [x] 3.2 Render the summary tiles: tokens split into fresh input, output, cache read and cache write; turn count; total, average and median cost with the unpriced count beside them; tool calls, average per turn, and failures
- [x] 3.3 Add the per-turn token chart as inline SVG — one line per token kind on a shared scale, fixed per-turn spacing, horizontal scroll with the y-axis pinned outside it, and a point that reports its turn and figures
- [x] 3.4 Add the per-turn cost chart, rendered only when some turn was priced, and state the absence of pricing where it would otherwise sit
- [x] 3.5 Add the tool-call ranking with its criterion control (output size, input size, failure), labelling sizes as measured content size and attributing no money to a tool call
- [x] 3.6 Add the per-tool summary table: calls, failures, accumulated input and output size
- [x] 3.7 Add the costliest-requests ranking, each row identified by an excerpt of its user message and reporting turns, tool calls, tokens, and cost where priced
- [x] 3.8 Make every chart point and every ranked row a keyboard-reachable control that calls `jumpToItem`, with an accessible label naming its target
- [x] 3.9 Render each empty section as a statement of what is missing — no tool call recorded, no turn priced, nothing to analyse yet — never as zeroes

## 4. Wiring

- [x] 4.1 Make the model bar's usage indicator the button that opens the analysis, keeping what it displays unchanged and giving it the expected `aria-expanded`/`aria-haspopup` semantics
- [x] 4.2 Hold the open state in `App.tsx`, closed by default, and compute `analyzeSession` under a `useMemo` that returns early while the panel is closed
- [x] 4.3 Component-test the panel in `ui/src/components/SessionAnalysis.test.ts(x)`: it opens from the indicator, updates when a turn completes while open, shows tokens with no cost chart against an unpriced provider, ranks tool calls by the selected criterion, and renders the empty states on a bare session

## 5. Verification

- [x] 5.1 `npm run typecheck` across all workspaces
- [x] 5.2 `npm test --workspace ui`
- [ ] 5.3 Run the app: drive a session with several turns and a failing tool call, open the panel, and confirm the figures match the model bar, that the charts read correctly in both themes, and that jumping lands on the right message — including a tool call while tool display is off
- [x] 5.4 `openspec validate add-session-analysis --strict`
