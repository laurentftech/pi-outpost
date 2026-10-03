# Scenario coverage — add-structured-exchange-timeline

Capabilities: `structured-exchange-timeline` (new, 12 requirements) and `structured-exchange`
(`OnlySomeKindsMayBeProposed` modified: scoped to versions 1 and 2, plus one timeline scenario).

Test files cited below:

- `server/test/structuredExchangeTimeline.test.ts` — contract, schema and semantic rules (Node).
- `server/test/structuredExchangeTimelineLayout.test.ts` — the pure layout: positions, lanes, arrows, today.
- `server/test/structuredExchangeTimelineTools.test.ts` — `present_structure`, the figure and table writers.
- `ui/src/presentations/structuredExchangeTimeline.test.tsx` — the mounted view (vitest, jsdom, fake clock).
- `ui/src/components/ReplyStructuredExchange.test.tsx` — a timeline in a reply.

The view was also driven in the running bench (`npm run bench`, seeded `SEEDED_TIMELINE` in
`e2e/fixtures/seeded-transcript.ts`, also written to the plain server's workspace as a plan file): annotation/glyph overlap measured in real font metrics (none), Today
aligned with its header tag at several scroll positions, labels outside the scroller, selection by
click and keyboard, enlarge overlay, live-edited invalid files in the split viewer.

## structured-exchange-timeline

| Scenario | Coverage | Evidence |
| --- | --- | --- |
| AVersionTwoDocumentMeansTheSameUnderVersionThree | covered | `server/test/structuredExchangeTimeline.test.ts` — "AVersionTwoDocumentMeansTheSameUnderVersionThree": every version 2 conformance case (valid and invalid) re-declared as version 3 reaches the same verdict; valid ones yield the same envelope apart from the identifier, invalid ones the same rule and pointer list. "a version 3 graph is still proposable" covers the enriched rules applying to version 3. |
| EarlierVersionsDoNotAcquireTheTimeline | covered | `server/test/structuredExchangeTimeline.test.ts` — "EarlierVersionsDoNotAcquireTheTimeline": the programme declared as version 1 and as version 2 is refused by the Node check and the browser check. Also `shared/conformance/invalid/v3-timeline-under-version-2.json`. |
| FrozenCorporaKeepTheirVerdicts | covered | `server/test/structuredExchangeFrozenVersions.test.ts` — "… still reaches its recorded verdict" for every case of both locks; `unknown-version.json` moved to version 4 and is re-locked with a `changedAfterFreeze` reason in `shared/conformance/version-1.lock.json`. |
| AProducerChecksATimelineOutsideTheApplication | covered | `server/test/structuredExchangeValidatorCli.test.ts` — "agrees with the application on every conformance case" runs the bundled reference validator over every `v3-timeline-*` case in `shared/conformance/index.json` and requires each `expectedRule`. |
| ATaskHoldsSeveralDiscontinuousActivitiesAndMilestones | covered | `server/test/structuredExchangeTimeline.test.ts` — "ATaskHoldsSeveralDiscontinuousActivitiesAndMilestones" (2 activities with a gap and 3 milestones validate); `ui/src/presentations/structuredExchangeTimeline.test.tsx` — "draws every task row, bar, star and separator the document declares". |
| AnEmptyTaskIsValid | covered | `server/test/structuredExchangeTimeline.test.ts` — "AnEmptyTaskIsValid"; `shared/conformance/valid/v3-timeline-empty-task-and-anonymous-separator.json`. |
| AnAnonymousSeparatorIsValid | covered | `server/test/structuredExchangeTimeline.test.ts` — "AnAnonymousSeparatorIsValid"; `ui/src/presentations/structuredExchangeTimeline.test.tsx` — "draws every task row…" asserts the anonymous separator is drawn with an empty title. |
| PresentationDataIsRefused | covered | `server/test/structuredExchangeTimeline.test.ts` — "PresentationDataIsRefused": `color` and `x` are refused with pointers to exactly those properties and no graph/table phrasing; "a separator carrying dates is refused". |
| AnUnsupportedScaleIsRefused | covered | `server/test/structuredExchangeTimeline.test.ts` — "AnUnsupportedScaleIsRefused": `schema/enum` at `/data/time/scale`, message names `"month"`. |
| ATaskWithoutAnIdentifierIsRefused | covered | `server/test/structuredExchangeTimeline.test.ts` — "ATaskWithoutAnIdentifierIsRefused": missing `id` and missing `items` each refused at `/data/rows/2`, naming the property. |
| AnImpossibleDateIsRefused | covered | `server/test/structuredExchangeTimeline.test.ts` — "AnImpossibleDateIsRefused" (`invalid-date` at the `end`), and "a leap day is a real day only in a leap year". |
| AnInvertedActivityIsRefused | covered | `server/test/structuredExchangeTimeline.test.ts` — "AnInvertedActivityIsRefused": `inverted-range` at the activity. |
| AnInvertedTimeRangeIsRefused | covered | `server/test/structuredExchangeTimeline.test.ts` — "AnInvertedTimeRangeIsRefused": `inverted-range` at `/data/time`. |
| AnItemOutsideTheRangeIsRefused | covered | `server/test/structuredExchangeTimeline.test.ts` — "AnItemOutsideTheRangeIsRefused": a late milestone and an early activity each refused with `item-outside-range`; the message states the range. |
| ASingleDayActivityIsValid | covered | `server/test/structuredExchangeTimeline.test.ts` — "ASingleDayActivityIsValid"; `server/test/structuredExchangeTimelineLayout.test.ts` — "ASingleDayActivityIsValid (drawn with a visible width)" asserts one day's width. |
| DuplicateIdentifiersAreRefused | covered | `server/test/structuredExchangeTimeline.test.ts` — "DuplicateIdentifiersAreRefused": two tasks, and a task and an item, sharing an `id`. |
| ATimelineWithoutDependenciesIsValid | covered | `server/test/structuredExchangeTimeline.test.ts` — "ATimelineWithoutDependenciesIsValid"; layout tests with no dependencies yield no arrows (`plan([...])` cases). |
| ADependencyLinksAMilestoneToATask | covered | `server/test/structuredExchangeTimeline.test.ts` — "ADependencyLinksAMilestoneToATask" (valid, type omitted); `server/test/structuredExchangeTimelineLayout.test.ts` — "a task endpoint attaches at the task's span" asserts the arrow ends at the task's earliest item, read as finish-to-start. |
| AllFourGanttTypesAreAccepted | covered | `server/test/structuredExchangeTimeline.test.ts` — "AllFourGanttTypesAreAccepted"; `shared/conformance/valid/v3-timeline-four-dependency-types.json`; ends per type in the layout tests "AFinishToStartArrow" and "AStartToStartArrow". |
| AnUnknownDependencyTypeIsRefused | covered | `server/test/structuredExchangeTimeline.test.ts` — "AnUnknownDependencyTypeIsRefused": `schema/enum` at the `type`, message names all four types. |
| AnUnresolvedEndpointIsRefused | covered | `server/test/structuredExchangeTimeline.test.ts` — "AnUnresolvedEndpointIsRefused" and "an unidentified item cannot be named". |
| AnEmptyTaskCannotBeAnEndpoint | covered | `server/test/structuredExchangeTimeline.test.ts` — "AnEmptyTaskCannotBeAnEndpoint". |
| ASelfDependencyIsRefused | covered | `server/test/structuredExchangeTimeline.test.ts` — "ASelfDependencyIsRefused": task to its own item, and item to itself. |
| ADuplicateDependencyIsRefused | covered | `server/test/structuredExchangeTimeline.test.ts` — "ADuplicateDependencyIsRefused": pointer at the second; the same ends with another type is accepted. |
| ACycleIsRefused | covered | `server/test/structuredExchangeTimeline.test.ts` — "ACycleIsRefused": A→B→C→A refused with `dependency-cycle`, message names A, B and C. |
| AFinishToStartArrow | covered | `server/test/structuredExchangeTimelineLayout.test.ts` — "AFinishToStartArrow": starts at A's bar end, ends at B's bar start, satisfied, every segment orthogonal. |
| AStartToStartArrow | covered | `server/test/structuredExchangeTimelineLayout.test.ts` — "AStartToStartArrow": leaves A's start going left, ends at B's start. |
| AnUnsatisfiedDependencyIsShownNotRefused | covered | `server/test/structuredExchangeTimeline.test.ts` — "AnUnsatisfiedDependencyIsShownNotRefused (validation half)"; `server/test/structuredExchangeTimelineLayout.test.ts` — "AnUnsatisfiedDependencyIsShownNotRefused" (drawn, `satisfied: false`); `ui/src/presentations/structuredExchangeTimeline.test.tsx` — "draws one arrow per dependency, unsatisfied ones marked…" (dashed, `data-satisfied="false"`). |
| SameDayCountsAsSatisfied | covered | `server/test/structuredExchangeTimelineLayout.test.ts` — "SameDayCountsAsSatisfied". |
| ArrowsDoNotHideLabels | covered | `ui/src/presentations/structuredExchangeTimeline.test.tsx` — "draws one arrow per dependency, … beneath every glyph and label": every arrow precedes every annotation in paint order. Annotations carry a white halo; confirmed in the bench. |
| HidingDependenciesRemovesOnlyTheArrows | covered | `ui/src/presentations/structuredExchangeTimeline.test.tsx` — "HidingDependenciesRemovesOnlyTheArrows": no arrow drawn, the hidden notice names the count and the unsatisfied one, selection still lists the dependency, the text equivalent still lists dependencies. |
| ShowingThemAgainRestoresTheArrows | covered | Same file — "ShowingThemAgainRestoresTheArrows": all three arrows back, notice gone. |
| NoControlWithoutDependencies | covered | Same file — "NoControlWithoutDependencies". |
| CompactingDrawsOneRowPerSection | covered | `server/test/structuredExchangeTimelineLayout.test.ts` — "CompactingDrawsOneRowPerSection": rows become task (Kick-off), section System A, section System B; every item inside its section row; no label overlaps another label or glyph. `ui/src/presentations/structuredExchangeTimeline.test.tsx` — "draws one row per section, keeps tasks before the first separator, and comes back". |
| CompactingChangesOnlyTheDrawing | covered | Layout — "CompactingChangesOnlyTheDrawing (geometry half)": same dependencies and verdicts, same item x positions, task endpoint anchored at its span. View — "CompactingChangesOnlyTheDrawing": identical text equivalent and arrows, details name the item's task. |
| AnUnlabelledActivityIsNamedByItsTaskWhenCompacted | covered | Layout — "AnUnlabelledActivityIsNamedByItsTaskWhenCompacted" (and unannotated when expanded); view test asserts "Études bis" on the unlabelled bar. |
| TasksBeforeTheFirstSeparatorKeepTheirRows | covered | Layout — "TasksBeforeTheFirstSeparatorKeepTheirRows"; view test: "Kick-off" keeps its task label. |
| ExpandingRestoresOneRowPerTask | covered | View test "draws one row per section… and comes back": five task labels again, no section labels. |
| NoCompactControlWithoutSections | covered | `ui/src/presentations/structuredExchangeTimeline.test.tsx` — "NoCompactControlWithoutSections". |
| ATimelineWithATargetIsRefused | covered | `server/test/structuredExchangeTimeline.test.ts` — "ATimelineWithATargetIsRefused": `kind-not-proposable` at `/target` and `/removals`, message tells the producer to present the revised timeline. |
| ATimelineWithViewpointsIsRefused | covered | `server/test/structuredExchangeTimeline.test.ts` — "ATimelineWithViewpointsIsRefused". |
| EqualDurationsHaveEqualWidths | covered | `server/test/structuredExchangeTimelineLayout.test.ts` — "EqualDurationsHaveEqualWidths": 180 days is exactly twice 90. |
| MonthsAreNotEqualColumns | covered | `server/test/structuredExchangeTimelineLayout.test.ts` — "MonthsAreNotEqualColumns": March/February width ratio is 31/28; March starts at day 59. |
| YearsAndMonthsAreLabelled | covered | `server/test/structuredExchangeTimelineLayout.test.ts` — "YearsAndMonthsAreLabelled" (years 2026–2028, all 18 months, bands tile the axis); `ui/src/presentations/structuredExchangeTimeline.test.tsx` — "repeats the year each quarter…". |
| TimeZoneDoesNotMovePositions | covered | `server/test/structuredExchangeTimelineLayout.test.ts` — "TimeZoneDoesNotMovePositions": the layout computed in two child processes under `TZ=Pacific/Auckland` and `TZ=America/Los_Angeles` is byte-identical. |
| RowsKeepDeclarationOrder | covered | `server/test/structuredExchangeTimelineLayout.test.ts` — "RowsKeepDeclarationOrder"; `ui/src/presentations/structuredExchangeTimeline.test.tsx` — task labels in declared order. |
| ActivitiesAreBarsAndMilestonesAreStars | covered | `server/test/structuredExchangeTimelineLayout.test.ts` — "ActivitiesAreBarsAndMilestonesAreStars"; the view test counts `timeline-activity` rects and `timeline-milestone` star paths. |
| SeparatorsDoNotMoveTheAxis | covered | `server/test/structuredExchangeTimelineLayout.test.ts` — "SeparatorsDoNotMoveTheAxis": same width and the same item x positions with and without separators. |
| AnActivityShowsItsLabel | covered | `server/test/structuredExchangeTimelineLayout.test.ts` — "AnActivityShowsItsLabel"; view test "annotates labelled items…". |
| AMilestoneFallsBackToItsKind | covered | `server/test/structuredExchangeTimelineLayout.test.ts` — "AMilestoneFallsBackToItsKind"; view test shows `PDR` for the unlabelled PDR milestone. |
| AnUnlabelledItemIsNotAnnotated | covered | `server/test/structuredExchangeTimelineLayout.test.ts` — "AnUnlabelledItemIsNotAnnotated" (a kinded activity gets no text); view test: T4's activity has no annotation element. |
| CrowdedAnnotationsDoNotOverlap | covered | `server/test/structuredExchangeTimelineLayout.test.ts` — "CrowdedAnnotationsDoNotOverlap": three labelled milestones within a week over a labelled bar; no label box intersects another label or any other item's glyph, the row grew ≥3 lanes, all four labels drawn. Measured again in the bench in real font metrics: no clash. |
| DifferentMilestoneKindsLookDifferent | covered | `server/test/structuredExchangeTimelineLayout.test.ts` — "DifferentMilestoneKindsLookDifferent and TheSameKindLooksTheSameEverywhere"; view test "names every kind in the legend and draws one kind alike" (three distinct fills, legend SRR/PDR/CDR). |
| TheSameKindLooksTheSameEverywhere | covered | Same layout test: two PDR milestones on different tasks get the same tint. View test "colours a kinded bar by its kind, leaves an untyped one grey, and draws the legend by shape": two `étude` bars share a fill, a bar and a star of kind SRR share a colour, an untyped bar stays neutral grey, and the legend draws a bar, a star or both per kind. |
| TodayInsideTheRange | covered | `server/test/structuredExchangeTimelineLayout.test.ts` — "TodayInsideTheRange"; view test "draws Today at the reader's date, across the rows, with its tag in the header" (x, full body height, not focusable). |
| TheSameDocumentShowsANewToday | covered | Layout "TheSameDocumentShowsANewToday"; view test "moves when the reader's date does, with the document unchanged" (fake clock moved, same document). |
| TodayBeforeTheRange | covered | Layout "TodayBeforeTheRange"; view test "says which side of the range today is on, and draws no line…". |
| TodayAfterTheRange | covered | Layout "TodayAfterTheRange"; view test "marks the end edge when the plan is over". |
| ScrollingKeepsTodayAligned | covered | `ui/src/presentations/structuredExchangeTimeline.test.tsx` — "puts the labels outside the area that scrolls": header, body and Today line are inside the one scroller, so they cannot scroll apart. Bench: Today line and header tag at the same screen x after scrolling. |
| TaskLabelsStayInView | covered | Same view test: the label column is not inside the scroller. Bench: labels at the same screen x after scrolling to the end. |
| SelectingAMilestoneShowsItsDetails | covered | `ui/src/presentations/structuredExchangeTimeline.test.tsx` — "SelectingAMilestoneShowsItsDetails". |
| SelectingAnItemShowsItsDependencies | covered | View test "SelectingAnItemShowsItsDependencies": predecessors/successors listed with types, the unsatisfied one marked, both arrows emphasised; "a task label shows the dependencies naming the task". |
| ItemsAreReachableFromTheKeyboard | covered | View test "ItemsAreReachableFromTheKeyboard": `tabindex=0`, full `aria-label`, focus ring, Enter selects, Escape clears; body exposed as a `group` so the buttons reach assistive technology. Bench: Tab then Enter selected the next item. |
| TheAgentPresentsATimeline | covered | `server/test/structuredExchangeTimelineTools.test.ts` — "TheAgentPresentsATimeline": presented, `details.kind` is timeline, digest counts tasks, activities, milestones, dependencies. |
| TheAgentIsToldOfUnsatisfiedDependencies | covered | `server/test/structuredExchangeTimelineTools.test.ts` — "TheAgentIsToldOfUnsatisfiedDependencies": the digest names the dependency's ends and type. |
| ATimelineInAReplyIsDrawn | covered | `ui/src/components/ReplyStructuredExchange.test.tsx` — "draws a timeline as a timeline". |
| ARefusedTimelineIsExplained | covered | `server/test/structuredExchangeTimelineTools.test.ts` — "ARefusedTimelineIsExplained": error, no details, `inverted-range` and the pointer in the text. |
| TheTextualEquivalentListsEveryItem | covered | `ui/src/presentations/structuredExchangeTimeline.test.tsx` — "lists every row in order, every item, and every dependency with its verdict"; "keeps the envelope available". |
| TheFigureWriterRefusesATimeline | covered | `server/test/structuredExchangeTimelineTools.test.ts` — "TheFigureWriterRefusesATimeline" and "the table writer refuses a timeline too…": error, reason names present_structure, no file at the destination. |

## structured-exchange

| Scenario | Coverage | Evidence |
| --- | --- | --- |
| TableCarryingATargetIsRejected | covered | `server/test/structuredExchangeParse.test.ts` — "a table carries neither a target nor a removal"; `server/test/structuredExchangeTool.test.ts` — "refuses a table that tries to be a proposal". Unchanged by this change. |
| TableIsStillRenderedAndReadable | covered | `ui/src/presentations/StructuredExchangeView.test.tsx` — "renders table columns and rows in their declared order". Unchanged by this change. |
| TableReportsRolesWithoutBecomingAProposal | covered | `server/test/structuredExchange.test.ts` — "a table carrying roles still cannot be proposed". Unchanged by this change. |
| TimelineCarryingATargetIsRejected | covered | `server/test/structuredExchangeTimelineTools.test.ts` — "TimelineCarryingATargetIsRejected": refused with `kind-not-proposable` at `/target`, nothing reaches the interface; `server/test/structuredExchangeTimeline.test.ts` — "ATimelineWithATargetIsRefused". |
