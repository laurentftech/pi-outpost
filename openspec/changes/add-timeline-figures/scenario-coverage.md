# Scenario coverage — add-timeline-figures

Capability: `structured-exchange-timeline` (5 added requirements; `ATimelineTravelsLikeEveryOtherKind`
modified so `write_structure_figure` draws a timeline).

Test files cited below:

- `server/test/structuredExchangeTimelineFigure.test.ts` — the figure: content, dating, fit to width, scale.
- `server/test/structuredExchangeTimelineTools.test.ts` — `present_structure`, `write_structure_figure`, `write_structure_table`.
- `ui/src/presentations/structuredExchangeTimeline.test.tsx` — the reader drawn from the figure parts, downloads.
- `ui/src/components/ReplyStructuredExchange.test.tsx` — a timeline in a reply.

Also driven in the bench: the agent tool writes a plan figure (900 wide, one row per section) into
the bench report, which the viewer renders at 900 × 348; a reader download after selecting an item and toggling
both options holds three sections, no arrow, no selection, a dated line, and a bar of the same size as on
screen; the enlarged view downloads its own options; rapid toggles and repeated copies raise no error.

## structured-exchange-timeline

| Scenario | Coverage | Evidence |
| --- | --- | --- |
| AFigureHoldsEverythingTheReaderShows | covered | `server/test/structuredExchangeTimelineFigure.test.ts` — "AFigureHoldsEverythingTheReaderShows": the SVG holds title, separator and task labels, annotations, every year, 4 arrows, 3 stars, 4 bars, the legend kinds and the arrowhead markers. |
| TheFigureMatchesTheScreen | covered | `ui/src/presentations/structuredExchangeTimeline.test.tsx` — "draws every bar, star and arrow at the figure's coordinates": each bar's x/y/width, each star's path and each arrow's path in the view DOM equal the figure parts'. |
| AFigureUsesProjectColours | covered | `server/test/structuredExchangeTimelineFigure.test.ts` — "AFigureUsesProjectColours": the declared colour fills the SRR star and the legend entry is marked project colour. |
| AWrittenFigureNamesItsDate | covered | Same file — "AWrittenFigureNamesItsDate" (`3 Oct 2026`, no `Today`) and "outside the range, the date and the side are said in the header". |
| TheReferenceLineCanBeOmitted | covered | Same file — "TheReferenceLineCanBeOmitted", inside and outside the range: no line, no marker. |
| ALongPlanFitsAPage | covered | Same file — "ALongPlanFitsAPage": 18 months at width 900 is ≤ 900 wide, every year labelled, no annotation overlapping another or another item's glyph; "a plan too long for the width is drawn at the floor scale and says so". |
| ProportionsSurviveScaling | covered | Same file — "ProportionsSurviveScaling": a 180-day bar is exactly twice a 90-day bar at a fitted scale. |
| TheDownloadedFigureFollowsTheDisplayOptions | covered | `ui/src/presentations/structuredExchangeTimeline.test.tsx` — "TheDownloadedFigureFollowsTheDisplayOptions": after compact and hidden dependencies the copied SVG has section rows, no arrow, a dated line and no `Today`; "downloads a file named after the plan". |
| NoInteractionStateLeaves | covered | Same file — "NoInteractionStateLeaves": with an item selected and focused, the markup has no selection, emphasis, focus ring, details or tabindex. |
| TheAgentWritesATimelineFigure | covered | `server/test/structuredExchangeTimelineTools.test.ts` — "TheAgentWritesATimelineFigure": with `compact` and `width: 900` the file is ≤ 900 wide, has section rows, no `Today`, and the result gives the Markdown reference and the item/dependency count; "a timeline figure can leave the arrows and the date line out"; "a graph's narrowing asked of a timeline is refused, not ignored". |
| AnInvalidTimelineWritesNothing | covered | Same file — "AnInvalidTimelineWritesNothing": refused, no file. |
| TheTableWriterStillRefusesATimeline | covered | Same file — "TheTableWriterStillRefusesATimeline, without sending the agent to the figure writer". |
| TheAgentPresentsATimeline | covered | Same file — "TheAgentPresentsATimeline". Unchanged by this change. |
| TheAgentIsToldOfUnsatisfiedDependencies | covered | Same file — "TheAgentIsToldOfUnsatisfiedDependencies". Unchanged. |
| ATimelineInAReplyIsDrawn | covered | `ui/src/components/ReplyStructuredExchange.test.tsx` — "draws a timeline as a timeline". Unchanged. |
| ARefusedTimelineIsExplained | covered | `server/test/structuredExchangeTimelineTools.test.ts` — "ARefusedTimelineIsExplained". Unchanged. |
| TheTextualEquivalentListsEveryItem | covered | `ui/src/presentations/structuredExchangeTimeline.test.tsx` — "lists every row in order, every item, and every dependency with its verdict". Unchanged. |
| TheFigureWriterRefusesATimeline | covered | `server/test/structuredExchangeTimelineTools.test.ts` — "TheTableWriterStillRefusesATimeline, without sending the agent to the figure writer" (the modified scenario now names the table writer only). |
