# Tasks

## 1. Figure

- [x] 1.1 Make `layoutTimeline` take `pxPerDay` (default unchanged) and shorten or omit month labels by band width; verify existing layout tests pass unchanged and new tests for *ProportionsSurviveScaling* and narrow month labels
- [x] 1.2 Add `timelineFigure` producing labels, header, rows and legend parts and a whole `Figure` (D1), with reference-line modes (D3) and fit-to-width (D2); verify by tests for *AFigureHoldsEverythingTheReaderShows*, *AWrittenFigureNamesItsDate*, *TheReferenceLineCanBeOmitted*, *ALongPlanFitsAPage* (no annotation overlaps), *AFigureUsesProjectColours*

## 2. Reader

- [x] 2.1 Draw `TimelineView`'s label column, header, rows and legend from the figure parts through `Drawn`, keeping selection, focus ring, emphasis, compact and dependency toggles in React; verify the existing timeline view tests pass and *TheFigureMatchesTheScreen* (coordinates equal between view DOM and figure)
- [x] 2.2 Offer "download SVG" and "copy markup" for a timeline, built from `timelineFigure` with the current options and a dated line (D5); verify *TheDownloadedFigureFollowsTheDisplayOptions* and *NoInteractionStateLeaves*

## 3. Writer

- [x] 3.1 Accept timelines in `figureForEnvelope` and add the timeline parameters to `write_structure_figure` (D4), refusing graph-only parameters for a timeline; update its description; verify *TheAgentWritesATimelineFigure*, *AnInvalidTimelineWritesNothing*, *TheTableWriterStillRefusesATimeline*, and replace the timeline figure refusal test from the timeline change
- [x] 3.2 Document a timeline figure in a report in the `structured-exchange` skill and `docs/structured-exchange.md`; verify the documented-examples test

## 4. Integration

- [x] 4.1 Rebuild (`web`, `@pi-outpost/embed`, `build:e2e-host`) and drive the bench with Playwright: compare view and downloaded SVG coordinates, download after compact + hidden dependencies, write a figure through the agent tool into a report and open the report in the viewer; monkey-test selection and toggles during download; report what broke
- [x] 4.2 Write `scenario-coverage.md`, run `npm run check:scenarios`, lint, typecheck, server and UI suites, and `openspec validate add-timeline-figures --strict`
