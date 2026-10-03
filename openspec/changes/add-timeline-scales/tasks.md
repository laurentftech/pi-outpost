# Tasks

## 1. Contract

- [x] 1.1 Widen `time.scale` to `week | month | quarter`.
  - Update `structured-exchange-3.json`, the skill copy, the generated browser check and the
    `StructuredTimelineData` type.
  - Move `v3-timeline-unsupported-scale` and its test to `day`.
  - Add valid `v3-` cases for `week` and `quarter`.
  - Verify *EveryScaleIsValid* and *AnUnsupportedScaleIsRefused*, and that every earlier v3 case keeps
    its verdict.

## 2. Layout and figure

- [x] 2.1 Add `TIMELINE_SCALE_PX_PER_DAY` and choose the header unit from density (D3).
  - Use ISO weeks; return upper and lower bands and unit lines.
  - Verify *WeeksAreNumbered*, *QuartersAreLabelled*, *TheHeaderFollowsAFittedDensity*.
  - Verify that the month-unit header is unchanged for existing month layouts, and that
    *EqualDurationsHaveEqualWidths* holds at each scale.
- [x] 2.2 Draw the header per unit in `timelineFigureParts`.
  - Carry period bands into the new bands.
  - Add `scale` to the figure options with the D7 precedence.
  - Verify *AFigureAtTheQuarterScale*, and that *ALongPlanFitsAPage* and *ProportionsSurviveScaling*
    still hold.

## 3. Reader

- [x] 3.1 Add the scale control (D8): open at the declared scale, fit with a resize observer (D4), and
  keep the middle date on change (D5).
  - Verify in the view tests: *TheTimelineOpensAtItsDeclaredScale*, *AQuarterIsNarrowerThanAMonth*,
    *FitShowsTheWholeRange*, *FitFollowsTheView*, *ChangingScaleKeepsTheMiddleDate*,
    *ChangingScaleKeepsTheSelection*.
- [x] 3.2 Add the opening framing (D6) as a pure helper, used on mount only.
  - Verify *AComparisonOpensOnItsFirstChange*, *APlainPlanOpensOnToday*, *TheReaderKeepsTheScroll*.
- [x] 3.3 Make download and copy follow the chosen scale; under fit, save at the drawn width.
  - Verify *TheDownloadedFigureFollowsTheScale*, and that *TheDownloadedFigureFollowsTheDisplayOptions*
    and *NoInteractionStateLeaves* still hold.

- [x] 3.4 Stretch a chosen scale to fill a wider view, keeping its header unit; make the unit a layout
  option that is never made finer, and apply the same to a figure given both a scale and a width.
  - Verify *AShortDrawingFillsTheView* and the revised *AQuarterIsNarrowerThanAMonth*, and that a
    stretched view is saved as drawn.
- [x] 3.5 Share the display options between the timeline in the conversation and its enlarged view.
  - Verify *TheEnlargedViewKeepsTheScale* and *AChoiceInTheEnlargedViewStays*.

## 4. Agent

- [x] 4.1 Add `scale` to `write_structure_figure`, with a description stating that `width` wins.
  - Verify *TheAgentChoosesAScale*, and that *TheAgentWritesATimelineFigure*,
    *AnInvalidTimelineWritesNothing* and *TheTableWriterStillRefusesATimeline* still hold.
- [x] 4.2 Document the scales and when to use each in the `structured-exchange` skill,
  `docs/structured-exchange.md` and `docs/comparison.md`.
  - Verify the documented-examples test.

## 5. Integration

- [x] 5.1 Rebuild `web`, `@pi-outpost/embed` and `build:e2e-host`, then drive the bench with Playwright.
  - Check that the comparison opens on its changes.
  - Switch week, month, quarter and fit, and read back the header labels and bar widths.
  - Resize under fit; select, then change scale; download at quarter scale.
  - Monkey-test: rapid scale switching, scale change while scrolled to the end, fit while compact, and
    comparison toggled mid-scroll. Report what broke.
- [x] 5.2 Final checks.
  - Write `scenario-coverage.md` and run `npm run check:scenarios`.
  - Run lint, typecheck, and the server and UI suites.
  - Run `openspec validate add-timeline-scales --strict`.
