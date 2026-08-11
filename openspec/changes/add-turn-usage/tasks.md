## 1. Wire protocol

- [x] 1.1 Add the `TurnUsage` interface to `shared/src/protocol.ts`: `input`, `output`, `cacheRead`, `cacheWrite`, `reasoning?`, `totalTokens`, `cost?` — documenting that `cost` is omitted rather than zeroed, and that this is a per-turn flow distinct from `ContextUsage`'s level
- [x] 1.2 Add optional `usage?: TurnUsage` to the assistant variant of `ChatItem`, noting that it is absent while streaming

## 2. Server extraction

- [x] 2.1 Add `messageUsage()` to `server/src/convert.ts`: accept a turn only when all four token counters are present and finite, derive `totalTokens` when the provider omits it, and carry `cost` only when `cost.total` is a finite number
- [x] 2.2 Attach the result in `assistantToItem` (the live `message_end` path)
- [x] 2.3 Attach the result in `historyToItems` (the replay path), so a reopened session reports the same figures
- [x] 2.4 Unit-test `messageUsage` in `server/test/convert.test.ts`: complete counters, a missing counter, a non-numeric counter, tokens without a price, an absent `usage` object, and `totalTokens` derived when omitted
- [x] 2.5 Unit-test that both converters carry usage through, and that an unpriced turn yields an item whose usage has no `cost`

## 3. UI aggregate

- [x] 3.1 Add `ui/src/util/sessionUsage.ts` with `sessionUsage(items)` returning cost, `unpriced`, turn count and token counters — excluding turns that reported nothing rather than counting them as zero
- [x] 3.2 Add `formatCost` (four decimals below one cent, two above, so a fraction of a cent never reads as `$0.00`) and `formatTokens` (950, 12k, 3.4M)
- [x] 3.3 Unit-test the aggregate in `ui/src/util/sessionUsage.test.ts`: priced turns, unpriced turns, a mix of both, non-assistant items ignored, an empty conversation, and both formatters at their boundaries

## 4. UI display

- [x] 4.1 Add a usage indicator to `ui/src/components/ModelBar.tsx`, beside the existing context ring, leading with the session's **token total** — the figure that exists on every deployment, priced or not
- [x] 4.2 Append the cost only when at least one turn was priced, and signal unpriced turns alongside it so a partial amount never reads as the whole
- [x] 4.3 Render nothing at all when no turn reported figures, so an idle session claims neither tokens nor spend
- [x] 4.4 Put the breakdown (input, output, cache read/write, turn count) in the indicator's `title`, keeping the bar itself to one figure
- [x] 4.5 Compute the aggregate where the item list already lives and pass it down, memoised, so it is not recomputed per unrelated render
- [x] 4.6 Component-test that the indicator updates when a turn completes, that it shows tokens with no cost against an unpriced provider, and that it is absent when nothing was reported

## 5. Verification

- [x] 5.1 `npm run typecheck` across all workspaces
- [x] 5.2 `npm test --workspace server` and `npm test --workspace ui`
- [x] 5.3 Run the app against a real turn and confirm the displayed token total matches what the provider reported; where a price exists, check it too
- [x] 5.4 `openspec validate add-turn-usage --strict`
