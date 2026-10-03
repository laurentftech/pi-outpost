# Scenario coverage — add-timeline-periods

Capability: `structured-exchange-timeline` (4 added requirements).

Test files cited below:

- `server/test/structuredExchangeTimeline.test.ts` — contract and rules ("ATimelineMayDeclarePeriodsAndReferenceDates").
- `server/test/structuredExchangeTimelineCalendar.test.ts` — layout, figure, legend, text, digest, comparison.

Also driven in the bench: the seeded programme with a year-end closure, summer holidays, an unnamed
inventory period and a contractual date — bands across every row and the header, names placed where they
fit, the calendar legend with every date, the bands kept in the compact view, in the comparison and in
"new version only", and in a downloaded SVG.

## structured-exchange-timeline

| Scenario | Coverage | Evidence |
| --- | --- | --- |
| PeriodsAndReferencesAreValid | covered | `server/test/structuredExchangeTimeline.test.ts` — "PeriodsAndReferencesAreValid"; `shared/conformance/valid/v3-timeline-calendar.json`. |
| APeriodRunningPastTheEdgeIsValid | covered | Same file — "APeriodRunningPastTheEdgeIsValid". |
| APeriodWhollyOutsideIsRefused | covered | Same file — "APeriodWhollyOutsideIsRefused"; `shared/conformance/invalid/v3-timeline-period-outside-range.json`. |
| AnInvertedPeriodIsRefused | covered | Same file — "AnInvertedPeriodIsRefused". |
| AReferenceOutsideTheRangeIsRefused | covered | Same file — "AReferenceOutsideTheRangeIsRefused"; `shared/conformance/invalid/v3-timeline-reference-outside-range.json`. |
| AnItemInsideAPeriodIsValid | covered | Same file — "AnItemInsideAPeriodIsValid" (an activity running through the closure is valid, nothing reported); also "a period's or reference's impossible day is refused" and "a reference needs a label, and neither carries presentation". |
| AClosureIsABandAcrossTheRows | covered | `server/test/structuredExchangeTimelineCalendar.test.ts` — "AClosureIsABandAcrossTheRows": band x and width from the dates, full height, every band before every item and arrow in paint order, named on hover. |
| PeriodKindsLookDifferent | covered | Same file — "PeriodKindsLookDifferent, with project colours": three distinct fills, the declared colour used for `holidays`. |
| AClippedPeriodIsDrawnInsideTheRange | covered | Same file — "AClippedPeriodIsDrawnInsideTheRange": a closure from 21 Dec starts at x 0 with three days' width. |
| AnUnkindedPeriodIsNeutral | covered | Same file — "AnUnkindedPeriodIsNeutral": neutral fill and hatch lines; a kinded band has none. |
| AContractDateIsANamedLine | covered | Same file — "AContractDateIsANamedLine": line at the day's middle across every row, dashed, named in the header, distinct from the solid Today line; "header names never overlap one another or the Today tag"; "the legend names every period and reference with its dates". |
| TheTextListsPeriodsAndReferences | covered | Same file — "TheTextListsPeriodsAndReferences"; "the digest counts them". |
| AComparisonCarriesTheCurrentPeriods | covered | Same file — "AComparisonCarriesTheCurrentPeriods". |
