# Spec Delta

## ADDED Requirements

### Requirement: ATimelineMayDeclarePeriodsAndReferenceDates

A version 3 timeline MAY declare `periods`, each with `start` and `end` (`YYYY-MM-DD`) and optionally a
`label` and an opaque `kind`, and `references`, each with a `date`, a `label` and optionally an opaque
`kind`. Neither SHALL carry coordinates, colours or shapes. A timeline declaring neither SHALL mean
exactly what it means today.

After schema validation, the system SHALL refuse, naming the rule and pointing at the value: a date that
is not a real day (`invalid-date`); a period that ends before it starts (`inverted-range`); a period lying
wholly outside the timeline's range (`period-outside-range`); a reference date outside the range
(`item-outside-range`). A period that overlaps the range's edge SHALL be valid. Periods SHALL constrain
nothing: an item may fall inside any period.

#### Scenario: PeriodsAndReferencesAreValid
- **WHEN** a timeline declares a year-end closure with kind `fermeture` and a contractual date reference
- **THEN** it is valid

#### Scenario: APeriodRunningPastTheEdgeIsValid
- **WHEN** a period starts before `time.start` and ends inside the range
- **THEN** it is valid

#### Scenario: APeriodWhollyOutsideIsRefused
- **WHEN** a period ends before `time.start`
- **THEN** the document is refused with `period-outside-range` at that period

#### Scenario: AnInvertedPeriodIsRefused
- **WHEN** a period's `start` is after its `end`
- **THEN** the document is refused with `inverted-range` at that period

#### Scenario: AReferenceOutsideTheRangeIsRefused
- **WHEN** a reference date is after `time.end`
- **THEN** the document is refused with `item-outside-range` at that reference

#### Scenario: AnItemInsideAPeriodIsValid
- **WHEN** an activity runs through a closure period
- **THEN** the document is valid, and nothing is reported about it

### Requirement: PeriodsAreDrawnAcrossEveryRow

The reader and every figure SHALL draw each period as a pale band from the start of its first day to the
end of its last, across every row, under bars, stars, arrows and annotations, clipped to the range. Its
colour SHALL follow its `kind` through the same palette and project colours items use; a period without a
kind SHALL be drawn neutral and hatched. Its label SHALL be shown in the header above the band where it
fits. It SHALL always be named in the legend, and its dates SHALL be given on hover. The legend SHALL
NOT repeat the dates, which the band already shows on the axis.

#### Scenario: AClosureIsABandAcrossTheRows
- **WHEN** a timeline declares a closure from 2026-12-21 to 2027-01-03
- **THEN** a band spans every row between those days, under the bars, and the header names it

#### Scenario: PeriodKindsLookDifferent
- **WHEN** a timeline declares a period of kind `fermeture` and one of kind `vacances`
- **THEN** they are drawn in distinct colours, and the project's colour for `vacances` is used when declared

#### Scenario: AClippedPeriodIsDrawnInsideTheRange
- **WHEN** a period starts before `time.start`
- **THEN** its band starts at the range's start

#### Scenario: AnUnkindedPeriodIsNeutral
- **WHEN** a period declares no kind
- **THEN** it is drawn neutral and hatched

### Requirement: ReferenceDatesAreNamedLines

The reader and every figure SHALL draw each reference date as a vertical line across every row at the
middle of its day, labelled in the header, distinct from the *Today* line, from month reference lines and
from period bands, named in the legend, and dated on hover. Its colour SHALL follow its kind as periods
do.

#### Scenario: AContractDateIsANamedLine
- **WHEN** a timeline declares a reference `{ "date": "2027-06-30", "label": "Contractual delivery" }`
- **THEN** a line is drawn at 2027-06-30 across every row, labelled "Contractual delivery", and it is not the Today line

### Requirement: PeriodsAndReferencesTravelWithTheTimeline

The textual equivalent SHALL list every period and reference with its dates, label and kind; the digest
returned to the agent SHALL count them; a downloaded or written figure SHALL draw them; and a comparison
produced by `compare_timelines` SHALL carry the current plan's periods and references, uncompared.

#### Scenario: TheTextListsPeriodsAndReferences
- **WHEN** the reader opens the textual equivalent of a timeline with a period and a reference
- **THEN** both are listed with their dates, label and kind

#### Scenario: AComparisonCarriesTheCurrentPeriods
- **WHEN** two plans are compared and the current one declares periods
- **THEN** the comparison carries those periods as declared
