# Tasks

## 1. Contract

- [x] 1.1 Extend `structured-exchange-3.json` in place with `comparedTo`, `previous` (shaped per item type) and `role` on tasks and items; update types, ceilings, the skill copy and the generated browser check; verify *AComparedTimelineIsValid*, *APlainTimelineIsUnchanged* and *PreviousDatesFollowTheItemShape*
- [x] 1.2 Add the rules `comparison-without-reference`, `contradictory-change`, `dependency-on-removed`, and `invalid-date` / `inverted-range` / `item-outside-range` for previous dates; verify one test per rule with rule and pointer
- [x] 1.3 Add `v3-` conformance cases for a compared timeline and each new rule; note in the conformance README that version 3 must not grow after its first release

## 2. Comparison logic

- [x] 2.1 Add a pure `compareTimelines(previous, current, label?)` pairing by `id` (D2, D5): previous dates, added, removed items and tasks, range union, uncompared counts; verify *TheToolPairsByIdentifier*, *TheToolCarriesRemovedItems*, *TheToolSaysWhatItCouldNotCompare* and that its output validates
- [x] 2.2 Add shift computation and wording (units, signs, start/end split); verify *ASlippedActivityShowsBothPositions*, *AStretchedActivityShowsBothEnds*, *AMovedMilestoneShowsWhereItWas* at the text level

## 3. Drawing

- [x] 3.1 Draw previous outlines, hollow stars, shift annotations, new badges and removed items in the layout and timeline figure, with ghosts in lane assignment (D3) and a legend; verify the drawing scenarios and that no annotation overlaps a ghost
- [x] 3.2 Add `comparison: "compare" | "new"` and `onlyChanged` to layout and figure (D4); verify *TheNewVersionOnlyLooksLikeAPlainPlan* (equal to the stripped document's figure) and *OnlyWhatMovedHidesUnchangedTasks*

## 4. Reader

- [x] 4.1 Show the reference plan's label, the comparison/new-version control and the only-what-moved control in `TimelineView`; downloads follow them; verify *TheReferencePlanIsNamed*, *BackToTheComparison* and the download scenarios
- [x] 4.2 Extend the textual equivalent and the `present_structure` digest; verify *TheTextListsEveryChange* and *TheAgentIsToldWhatMoved*

## 5. Agent tools

- [x] 5.1 Add `compare_timelines` (D5) and register it wherever `write_structure_figure` is; verify *TheInputsStayPure*, *AnInvalidInputIsRefused*, presentation, and output written only inside the writable zone
- [x] 5.2 Add `comparison` to `write_structure_figure`; verify *TheAgentWritesTheComparedVersion* and *TheAgentWritesTheNewVersion*
- [x] 5.3 Document comparing plans in the `structured-exchange` skill (give items ids; use the tool, never compute shifts by hand) and `docs/structured-exchange.md`; verify the documented-examples test

## 6. Integration

- [x] 6.1 Seed two versions of a plan in the bench, rebuild, and drive with Playwright: compare through the agent tool, switch views, filter, download both views, enlarge; monkey-test toggles in every combination with compact and hidden dependencies; report what broke
- [x] 6.2 Write `scenario-coverage.md`, run `npm run check:scenarios`, lint, typecheck, server and UI suites, and `openspec validate add-timeline-comparison --strict`
