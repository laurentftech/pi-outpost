## 1. Registry seam

- [x] 1.1 Add `ui/src/presentations/registry.ts`: a `Presentation` type (`id`, `match(item)`, `Component`) and an ordered array matching the table in `design.md`. Export `selectPresentation(item): Presentation` — total, last entry matches unconditionally.
- [x] 1.2 Add `ui/src/presentations/registry.test.ts`: order/priority, totality, malformed `args`, malformed `output`, and the running→done stability rule (a specialized pick is never revoked).

## 2. Relocate existing behaviour (no visible change)

- [x] 2.1 Move `editPairs` (`ToolCard.tsx:28`) and `writeContent` (`:40`) into presentation entries; keep `SplitDiffBlock`/`DiffBlock`/`diffLines` as the renderers.
- [x] 2.2 Move the `outputHtml` → `RenderedHtml` branch (`:125`), the `getFormattedToolOutput` branch (`:53`), and the `<pre>` fallback (`:128`) into entries.
- [x] 2.2a Split `getFormattedToolOutput` (design.md decision 6): export `parseLooseJson` from `ui/src/util/toolOutput.ts` and narrow the function to the `__pi_render` envelope; move `formatParsedObject` to `ui/src/presentations/orientSummary.ts` as `formatOrientSummary`, matching on the openlore field shape. Relocate the affected cases from `toolOutput.test.ts` to `orientSummary.test.ts`. Rendered output must be unchanged for every input.
- [x] 2.3 Rewrite `ToolCard.tsx` to call `selectPresentation` and render the result inside the common card (status dot, `argsSummary` header, expand toggle, raw-output reveal). Delete every inline branch — no dual dispatch.
- [x] 2.4 Confirm `ToolCard.test.tsx` still passes unmodified. Any required edit to it is a behaviour change and must be justified.

## 3. Wire the collapsed extension rendering

- [x] 3.1 Consume `item.outputHtmlCollapsed` (already delivered via `ui/src/useAgent.ts:503`, currently unread) for the collapsed state; fall back to the summary presentation. *Shipped without the intermediate `outputHtml` fallback: an extension that supplied no compact rendering keeps today's bare folded header, because showing the full body while folded is not a preview of itself.*
- [x] 3.2 Test: collapsed state prefers `outputHtmlCollapsed`; expanded state still shows `outputHtml`.

## 4. Actions

- [x] 4.1 Define the closed action enum from `design.md` (`openFile`, `openFileHistory`, `openWorktreeDiff`, `searchWorkspace`) and a dispatcher mapping each to the existing `useAgent` action. Presentations receive the dispatcher, never `sendMessage`. *`copy` is not an enum member: `design.md` maps it to the existing `CopyButton` component, which needs no dispatch, so an enum entry would be dead.*
- [x] 4.2 Thread the dispatcher from `ui/src/App.tsx` (where `useAgent` is already destructured) down to `ToolCard`.
- [x] 4.3 Test: an unknown action name is not offered and sends nothing.

## 5. New presentations

- [x] 5.1 Code search (`grep`): parse `path:line:text` hits, group by file, cap the visible list with a reveal, `openFile` per hit. Falls back to raw when parsing yields no hits.
- [x] 5.2 Git diff (`bash` + `/^\s*git\s+(diff|show)\b/`): parse unified diff into per-file blocks, render with `DiffBlock`, offer `openFile` / `openFileHistory` per file.
- [x] 5.3 Tests for both: happy path, empty result, unparseable output → raw fallback, actions fire the right dispatcher entry.

## 6. Verification

- [x] 6.1 Test that a tool output containing `<script>` renders as escaped text under every presentation, and that `RenderedHtml` is never reached from `item.output`.
- [x] 6.2 Run the full UI suite and the coverage gate (CI already gates line coverage).
- [x] 6.3 `openspec validate add-tool-result-presentations --strict`.
- [ ] 6.4 Manually verify keyboard navigation and narrow-width behaviour on both new presentations.
