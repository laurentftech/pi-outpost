# Tasks

## 1. Contract

- [x] 1.1 Extend `structured-exchange-3.json` with `periods` and `references` (ceilings 100 and 50), update types, the skill copy and the generated browser check; verify *PeriodsAndReferencesAreValid* and that every earlier timeline case keeps its verdict
- [x] 1.2 Add the rules (`invalid-date`, `inverted-range`, `period-outside-range`, `item-outside-range` for references) and `v3-` conformance cases; verify *APeriodRunningPastTheEdgeIsValid*, *APeriodWhollyOutsideIsRefused*, *AnInvertedPeriodIsRefused*, *AReferenceOutsideTheRangeIsRefused*, *AnItemInsideAPeriodIsValid*

## 2. Drawing

- [x] 2.1 Lay out periods (clipped bands) and references (lines) and their header labels with collision handling (D4); verify positions for *AClosureIsABandAcrossTheRows*, *AClippedPeriodIsDrawnInsideTheRange*, *AContractDateIsANamedLine*
- [x] 2.2 Draw them in the timeline figure in the order of D5 with kind colours, neutral hatch and legend entries; verify *PeriodKindsLookDifferent*, *AnUnkindedPeriodIsNeutral*, legend text, and that bands are under bars in paint order

## 3. Elsewhere

- [x] 3.1 Text equivalent, digest, and `compareTimelines` carrying periods and references; verify *TheTextListsPeriodsAndReferences*, *AComparisonCarriesTheCurrentPeriods*
- [x] 3.2 Document periods and references in the `structured-exchange` skill and `docs/structured-exchange.md`; verify the documented-examples test

## 4. Integration

- [x] 4.1 Seed a closure, holidays and a contractual date in the bench, rebuild, drive with Playwright (reader, compact, comparison, download, figure in the report), monkey-test toggles; report what broke
- [x] 4.2 Write `scenario-coverage.md`, run `npm run check:scenarios`, lint, typecheck, server and UI suites, `openspec validate add-timeline-periods --strict`
