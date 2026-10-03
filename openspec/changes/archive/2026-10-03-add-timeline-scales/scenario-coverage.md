# Scenario coverage — add-timeline-scales

Capability: `structured-exchange-timeline` (2 added, 5 modified requirements).

Test files cited below:

- `server/test/structuredExchangeTimeline.test.ts` — contract and rules.
- `server/test/structuredExchangeTimelineLayout.test.ts` — the month layout, unchanged.
- `server/test/structuredExchangeTimelineScales.test.ts` — densities, header units, opening scroll, figures at a scale.
- `server/test/structuredExchangeTimelineFigure.test.ts` — figures fitted to a width.
- `server/test/structuredExchangeTimelineTools.test.ts` — `write_structure_figure`.
- `ui/src/presentations/structuredExchangeTimeline.test.tsx` — the reader: scale control, fill, fit, enlarged view, framing, downloads.

Also driven in the bench (`npm run bench`, rebuilt):

- **Opening.** The comparison opens on its changes, with 4 of 5 in view.
- **Scales.** I switched through week, month, quarter and fit, and read back the header units and widths:
  - week: W40…;
  - quarter: Q4, Q1…, filling the 545 px view;
  - fit: the whole range.
- **Enlarged view.** It opens at quarter with one row per section, filled to 1019 px. A week chosen in it stays after it closes.
- **Fit.** Under fit, the enlarged view follows the window: 876 → 555 px.
- **Monkey tests.** No page error and no stuck state after any of these:
  - rapid switching;
  - a scale change while scrolled to the end;
  - a scale change with an item selected, which stays selected with its details;
  - a comparison toggle mid-scroll, which keeps the scroll;
  - a copy at quarter, which gives Q2 and no Feb.

## structured-exchange-timeline

| Scenario | Coverage | Evidence |
| --- | --- | --- |
| TheTimelineOpensAtItsDeclaredScale | covered | `ui/src/presentations/structuredExchangeTimeline.test.tsx` — "TheTimelineOpensAtItsDeclaredScale": `week` pressed, drawn at 12 px a day, `W40` in the header; `server/test/structuredExchangeTimelineScales.test.ts` — "a timeline is laid out at its declared scale's density". |
| AQuarterIsNarrowerThanAMonth | covered | View test "AQuarterIsNarrowerThanAMonth" (view narrower than the quarter drawing): bar shrinks by 0.75/4, 214/120 ratio kept, `Q1` labelled; layout test "AQuarterIsNarrowerThanAMonth, and proportions hold at every scale". |
| AShortDrawingFillsTheView | covered | View test "AShortDrawingFillsTheView": quarter fills 600 px, header exactly `Q4…Q1`, no month; "a short plan at the month scale fills the view and keeps months"; layout test "a chosen unit is never made finer by a stretched density". |
| TheEnlargedViewKeepsTheScale | covered | View test "TheEnlargedViewKeepsTheScale": quarter and one row per section chosen inline, the enlarged copy shows `quarter` pressed, section rows, `Q1`. |
| AChoiceInTheEnlargedViewStays | covered | View test "AChoiceInTheEnlargedViewStays": `week` chosen in the enlarged view, closed with Escape, inline copy is at `week` with `W40`. |
| FitShowsTheWholeRange | covered | View test "FitShowsTheWholeRange": drawing wider than the view at month, equal to the view under fit. |
| FitFollowsTheView | covered | View test "FitFollowsTheView": the observed width changes to 400, the drawing follows. |
| ChangingScaleKeepsTheMiddleDate | covered | View test "ChangingScaleKeepsTheMiddleDate": 15 June 2027 at the middle at month, at week, and back. |
| ChangingScaleKeepsTheSelection | covered | View test "ChangingScaleKeepsTheSelection": item still pressed, details text identical. |
| AComparisonOpensOnItsFirstChange | covered | `server/test/structuredExchangeTimelineScales.test.ts` — "AComparisonOpensOnItsFirstChange" (scroll puts the earlier, previous position in view with a sixth's lead-in), "an addition or a removal counts as a change", "a comparison with its changes already in view… stays at its start"; view test "AComparisonOpensOnItsFirstChange" (today late, changes early: the view stays on the changes). |
| APlainPlanOpensOnToday | covered | Layout test "APlainPlanOpensOnToday"; view test "APlainPlanOpensOnToday": scroll puts Today at a third of the view. |
| TheReaderKeepsTheScroll | covered | View test "TheReaderKeepsTheScroll": scroll 500 survives two comparison toggles. |
| ATaskHoldsSeveralDiscontinuousActivitiesAndMilestones | covered | `server/test/structuredExchangeTimeline.test.ts` — "ATaskHoldsSeveralDiscontinuousActivitiesAndMilestones". |
| AnEmptyTaskIsValid | covered | Same file — "AnEmptyTaskIsValid"; `shared/conformance/valid/v3-timeline-empty-task-and-anonymous-separator.json`. |
| AnAnonymousSeparatorIsValid | covered | Same file — "AnAnonymousSeparatorIsValid". |
| PresentationDataIsRefused | covered | Same file — "PresentationDataIsRefused". |
| EveryScaleIsValid | covered | Same file — "EveryScaleIsValid": `week` and `quarter` valid in Node and the browser, digest equal and text equal apart from the scale named; `shared/conformance/valid/v3-timeline-week-scale.json`, `v3-timeline-quarter-scale.json`. |
| AnUnsupportedScaleIsRefused | covered | Same file — "AnUnsupportedScaleIsRefused": `day` refused, `schema/enum` at `/data/time/scale`, message names `week`, `month` and `quarter`; `shared/conformance/invalid/v3-timeline-unsupported-scale.json`. |
| ATaskWithoutAnIdentifierIsRefused | covered | Same file — "ATaskWithoutAnIdentifierIsRefused". |
| EqualDurationsHaveEqualWidths | covered | `server/test/structuredExchangeTimelineLayout.test.ts` — "EqualDurationsHaveEqualWidths"; at every scale, `server/test/structuredExchangeTimelineScales.test.ts` — "AQuarterIsNarrowerThanAMonth, and proportions hold at every scale". |
| MonthsAreNotEqualColumns | covered | `server/test/structuredExchangeTimelineLayout.test.ts` — "MonthsAreNotEqualColumns". |
| YearsAndMonthsAreLabelled | covered | Same file — "YearsAndMonthsAreLabelled"; scales file — "the month unit is unchanged". |
| WeeksAreNumbered | covered | `server/test/structuredExchangeTimelineScales.test.ts` — "WeeksAreNumbered": `Mar 2027`, `Apr 2027` over W9–W17, a line at each Monday, the cut last week five days wide; "ISO weeks: week 1 holds the year's first Thursday". |
| QuartersAreLabelled | covered | Same file — "QuartersAreLabelled": 2026–2028 over Q1–Q4 three times, lines at quarter starts; "a range starting mid-quarter labels that quarter first". |
| TheHeaderFollowsAFittedDensity | covered | Same file — "TheHeaderFollowsAFittedDensity": a three-year week-scale plan fitted into 900 px labels no week, all three years named; "a scale asked with a width sets the coarsest the header may be finer than". |
| TimeZoneDoesNotMovePositions | covered | `server/test/structuredExchangeTimelineLayout.test.ts` — "TimeZoneDoesNotMovePositions". |
| ALongPlanFitsAPage | covered | `server/test/structuredExchangeTimelineFigure.test.ts` — "ALongPlanFitsAPage". |
| ProportionsSurviveScaling | covered | Same file — "ProportionsSurviveScaling". |
| AFigureAtTheQuarterScale | covered | `server/test/structuredExchangeTimelineScales.test.ts` — "AFigureAtTheQuarterScale": quarter density and unit, header and rows deep-equal to the timeline declared at quarter; "without a scale or width the figure uses the declared scale"; "a width wins over a scale". |
| TheDownloadedFigureFollowsTheDisplayOptions | covered | `ui/src/presentations/structuredExchangeTimeline.test.tsx` — "TheDownloadedFigureFollowsTheDisplayOptions". |
| TheDownloadedFigureFollowsTheScale | covered | Same file — "TheDownloadedFigureFollowsTheScale": copied markup has `Q2` and no `Feb`; "a fitted view is saved at the width it is drawn at": the study bar's on-screen width appears in the markup. |
| NoInteractionStateLeaves | covered | Same file — "NoInteractionStateLeaves". |
| TheAgentWritesATimelineFigure | covered | `server/test/structuredExchangeTimelineTools.test.ts` — "TheAgentWritesATimelineFigure". |
| TheAgentChoosesAScale | covered | Same file — "TheAgentChoosesAScale": `W12` and `Mar 2027` in the file, wider than 548 × 12 px, the parameter offered with its three values; "a width wins over a scale". |
| AnInvalidTimelineWritesNothing | covered | Same file — "AnInvalidTimelineWritesNothing". |
| TheTableWriterStillRefusesATimeline | covered | Same file — "TheTableWriterStillRefusesATimeline, without sending the agent to the figure writer". |
