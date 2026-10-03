# Scenario coverage — add-timeline-comparison

Capability: `structured-exchange-timeline` (8 added requirements).

Test files cited below:

- `server/test/structuredExchangeTimeline.test.ts` — contract and rules for compared timelines.
- `server/test/structuredExchangeTimelineComparison.test.ts` — `compareTimelines`, shift wording.
- `server/test/structuredExchangeTimelineComparisonDrawing.test.ts` — layout and figure of a comparison.
- `server/test/structuredExchangeTimelineTools.test.ts` — `compare_timelines`, `write_structure_figure`, the digest.
- `ui/src/presentations/structuredExchangeTimeline.test.tsx` — the reader ("a compared timeline in the reader").

Driven in the bench as well: a comparison presented in the conversation (previous dates dashed, shifts,
"Audit externe" struck, a new PDR), "only what moved" (2 tasks, "2 unchanged tasks hidden"), compact and
hidden dependencies combined, switching views repeatedly with an item selected, downloads following the
view; on the plain server `compare_timelines` and `write_structure_figure` produced a 900-wide comparison
figure rendered in the bench report. A long label cut at the figure's edge was found there and fixed.

## structured-exchange-timeline

| Scenario | Coverage | Evidence |
| --- | --- | --- |
| AComparedTimelineIsValid | covered | `server/test/structuredExchangeTimeline.test.ts` — "AComparedTimelineIsValid"; `shared/conformance/valid/v3-timeline-compared.json`. |
| APlainTimelineIsUnchanged | covered | Same file — "APlainTimelineIsUnchanged"; every earlier timeline test and conformance case passes unchanged. |
| PreviousDatesFollowTheItemShape | covered | Same file — "PreviousDatesFollowTheItemShape": a milestone with `{start,end}` is refused at its `previous`; `shared/conformance/invalid/v3-timeline-previous-wrong-shape.json`. |
| ComparisonWithoutReferenceIsRefused | covered | Same file — "ComparisonWithoutReferenceIsRefused": `previous` and a task `role` without `comparedTo`, each at its pointer. |
| AnAddedItemWithPreviousDatesIsRefused | covered | Same file — "AnAddedItemWithPreviousDatesIsRefused"; also "an item removed inside an added task is contradictory". |
| PreviousDatesOutsideTheRangeAreRefused | covered | Same file — "PreviousDatesOutsideTheRangeAreRefused" (message says the range covers both plans); "previous dates are real days, in order". |
| ADependencyOnARemovedItemIsRefused | covered | Same file — "ADependencyOnARemovedItemIsRefused": both dependencies naming the removed milestone, at `from` and `to`. |
| ASlippedActivityShowsBothPositions | covered | `server/test/structuredExchangeTimelineComparisonDrawing.test.ts` — "ASlippedActivityShowsBothPositions": previous bar at the old dates, current at the new, annotation `Study +3 wk`; UI "draws previous positions, shifts, new and removed marks". |
| AStretchedActivityShowsBothEnds | covered | Same drawing file — "AStretchedActivityShowsBothEnds" (`Design end +4 wk`); text level in `structuredExchangeTimelineComparison.test.ts`. |
| AMovedMilestoneShowsWhereItWas | covered | Same drawing file — "AMovedMilestoneShowsWhereItWas": previous and current star centres, `PDR +2 wk`, a hollow dashed star in the SVG. |
| AddedAndRemovedAreMarked | covered | Same drawing file — "AddedAndRemovedAreMarked": `· new`, struck annotation, comparison legend; UI test asserts `data-change` and `text-decoration`. |
| TheReferencePlanIsNamed | covered | Same drawing file — "TheReferencePlanIsNamed" (figure); UI — "TheReferencePlanIsNamed" (view, with date). |
| TheNewVersionOnlyLooksLikeAPlainPlan | covered | Drawing file — "TheNewVersionOnlyLooksLikeAPlainPlan": the "new" figure is byte-identical to the stripped document's and to the current plan's; UI — "switches to the new version only, and back…". |
| BackToTheComparison | covered | UI — "switches to the new version only, and back (… BackToTheComparison)"; drawing file — "BackToTheComparison (figure level)". |
| OnlyWhatMovedHidesUnchangedTasks | covered | Drawing file — "OnlyWhatMovedHidesUnchangedTasks" (rows kept, `hiddenTasks`), "a plain timeline ignores the filter"; UI — "OnlyWhatMovedHidesUnchangedTasks" (labels and notice). |
| TheTextListsEveryChange | covered | UI — "TheTextListsEveryChange": reference plan, moved items with amount and previous dates, removed item, new task. |
| TheAgentIsToldWhatMoved | covered | `server/test/structuredExchangeTimelineTools.test.ts` — "compare_timelines presents the comparison and tells the agent what moved (TheAgentIsToldWhatMoved)": `1 moved, 1 added, 1 removed; largest slip: "System Requirements Review" +3 wk`. |
| TheToolPairsByIdentifier | covered | `server/test/structuredExchangeTimelineComparison.test.ts` — "TheToolPairsByIdentifier"; tools test asserts `srr` previous date. |
| TheToolCarriesRemovedItems | covered | Comparison test — "TheToolCarriesRemovedItems": removed item under its task, removed task kept in place. |
| TheToolSaysWhatItCouldNotCompare | covered | Comparison test — "TheToolSaysWhatItCouldNotCompare" (counts, no role on unpaired items); tools test asserts the sentence. |
| TheInputsStayPure | covered | Tools test — "TheInputsStayPure": both inputs byte-identical after writing, output equals the presented document, no overwrite; "the output stays inside the writable zone". |
| AnInvalidInputIsRefused | covered | Tools test — "AnInvalidInputIsRefused": rule and pointer, nothing presented, no file. |
| TheAgentWritesTheComparedVersion | covered | Tools test — "TheAgentWritesTheComparedVersion and TheAgentWritesTheNewVersion": previous outlines, reference label and shift in the SVG. |
| TheAgentWritesTheNewVersion | covered | Same test: with `comparison: "new"` no previous outline, reference, shift or strike. |
