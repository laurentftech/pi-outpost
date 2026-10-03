# structured-exchange-timeline Specification

## Purpose
Lets an agent carry a project schedule — tasks, activities, milestones and group separators on a
calendar axis — as validated structured-exchange data that the interface draws natively, with the
reader's own current date shown against the plan, so the schedule can be maintained as data rather
than redrawn as a picture.

## Requirements

### Requirement: TimelineOpensVersionThree

The system SHALL publish a version 3 structured-exchange contract, identified as
`urn:structured-exchange:3`, as a Git-tracked JSON Schema committed with its implementation and tests,
and SHALL validate against that committed copy without network access.

Version 3 SHALL accept everything version 2 accepts, with the same meaning, and SHALL add exactly one
kind, `timeline`. Versions 1 and 2 SHALL NOT acquire the timeline: a document declaring either of
their identifiers with `kind: "timeline"` SHALL be refused, and every case in the frozen version 1 and
version 2 conformance corpora SHALL reach its recorded verdict.

A producer SHALL be able to check a version 3 document outside the application, with the same schema,
semantic rules and diagnostics the application applies.

#### Scenario: AVersionTwoDocumentMeansTheSameUnderVersionThree
- **WHEN** a document valid under version 2 is re-declared with the version 3 identifier and validated
- **THEN** it is valid, and it is presented exactly as its version 2 form is

#### Scenario: EarlierVersionsDoNotAcquireTheTimeline
- **WHEN** a document declaring the version 1 or the version 2 identifier has `kind: "timeline"`
- **THEN** it is refused

#### Scenario: FrozenCorporaKeepTheirVerdicts
- **WHEN** the frozen version 1 and version 2 conformance corpora are validated after version 3 exists
- **THEN** every case reaches its recorded verdict

#### Scenario: AProducerChecksATimelineOutsideTheApplication
- **WHEN** a producer checks a version 3 timeline with the standalone check
- **THEN** it reaches the verdict and the diagnostics the application would

### Requirement: ATimelineDeclaresCalendarRowsAndItems

A timeline's `data` SHALL declare a `time` range and an ordered `rows` array, and MAY declare a
`title` and `dependencies`. `time` SHALL declare `start` and `end` as calendar dates written
`YYYY-MM-DD`, and `scale`, one of `week`, `month` or `quarter`. `scale` SHALL name the scale the timeline
is opened at. It SHALL NOT change any date, rule or comparison.

Each row SHALL declare a `type` of `task` or `separator`. A task SHALL declare an `id`, a `label` and
an `items` array, which MAY be empty. A separator SHALL declare nothing else, and MAY declare a
`label`; it SHALL NOT carry dates or items.

Each item SHALL declare a `type` of `activity` or `milestone`. An activity SHALL declare `start` and
`end`; a milestone SHALL declare `date`. Either MAY declare an `id`, a `label` and a `kind`. `kind`
SHALL be opaque, as an element's kind is: the renderer may colour by it and SHALL NOT interpret it.

The data SHALL NOT carry coordinates, sizes, colours, shapes or a current date; a document carrying
any property the schema does not declare SHALL be refused. A task MAY hold any number of activities
and milestones within the contract's ceilings, in any order, overlapping or not.

#### Scenario: ATaskHoldsSeveralDiscontinuousActivitiesAndMilestones
- **WHEN** a timeline's task declares two activities separated by a gap and three milestones
- **THEN** it is valid, and all five items are drawn on that task's row

#### Scenario: AnEmptyTaskIsValid
- **WHEN** a task declares an empty `items` array
- **THEN** it is valid, and its row is drawn with its label and no items

#### Scenario: AnAnonymousSeparatorIsValid
- **WHEN** a separator declares only its `type`
- **THEN** it is valid, and it is drawn as a divider with no title

#### Scenario: PresentationDataIsRefused
- **WHEN** an item declares a property the schema does not define, such as `x`, `color` or `shape`
- **THEN** the document is refused, and the diagnostic points at that property

#### Scenario: EveryScaleIsValid
- **WHEN** the same timeline declares `scale` as `week`, then `month`, then `quarter`
- **THEN** it is valid each time, and its textual equivalent and digest are the same apart from the scale named

#### Scenario: AnUnsupportedScaleIsRefused
- **WHEN** a timeline declares a `scale` of `day`
- **THEN** it is refused, and the diagnostic names the supported values

#### Scenario: ATaskWithoutAnIdentifierIsRefused
- **WHEN** a task row omits its `id` or its `items`
- **THEN** the document is refused, and the diagnostic points at that row

### Requirement: TimelineDatesAreCheckedAfterTheSchema

After schema validation, the system SHALL refuse a timeline, naming the rule and pointing at the
offending value, when:

- a date is not a real calendar date (`invalid-date`), such as `2027-02-30`;
- `time.start` is after `time.end` (`inverted-range`);
- an activity's `start` is after its `end` (`inverted-range`);
- an activity or a milestone falls wholly or partly outside `time.start`–`time.end`
  (`item-outside-range`);
- two tasks or items share an `id` (`duplicate-identifier`).

A range whose start equals its end SHALL be valid. A timeline that is refused SHALL NOT be drawn.

#### Scenario: AnImpossibleDateIsRefused
- **WHEN** an activity declares `end: "2027-02-30"`
- **THEN** the document is refused with `invalid-date`, pointing at that `end`

#### Scenario: AnInvertedActivityIsRefused
- **WHEN** an activity's `start` is after its `end`
- **THEN** the document is refused with `inverted-range`, pointing at that activity

#### Scenario: AnInvertedTimeRangeIsRefused
- **WHEN** `time.start` is after `time.end`
- **THEN** the document is refused with `inverted-range`, pointing at `time`

#### Scenario: AnItemOutsideTheRangeIsRefused
- **WHEN** a milestone's `date` is after `time.end`, or an activity starts before `time.start`
- **THEN** the document is refused with `item-outside-range`, and the message states the declared range

#### Scenario: ASingleDayActivityIsValid
- **WHEN** an activity's `start` equals its `end`
- **THEN** it is valid and drawn with a visible width

#### Scenario: DuplicateIdentifiersAreRefused
- **WHEN** two tasks, or a task and an item, declare the same `id`
- **THEN** the document is refused with `duplicate-identifier`

### Requirement: ATimelineMayDeclareGanttDependencies

A timeline MAY declare `dependencies`, an array in which each dependency SHALL declare a `from`
(predecessor) and a `to` (successor), each the `id` of a task, an activity or a milestone of the same
document, and MAY declare a `type` among `finish-to-start`, `start-to-start`, `finish-to-finish` and
`start-to-finish`; a dependency without a `type` SHALL mean `finish-to-start`. A document without
`dependencies` SHALL be valid and drawn with no arrows.

A task as an endpoint SHALL stand for the span of all its items: it starts at its earliest item and
finishes at its latest. A milestone's start and finish SHALL both be its date.

After schema validation, the system SHALL refuse, naming the rule and pointing at the dependency:

- an endpoint naming no task or item of the document (`unresolved-endpoint`);
- a task endpoint whose task has no items (`empty-task-endpoint`);
- a dependency whose `from` and `to` name the same thing, or a task and one of its own items
  (`self-dependency`);
- two dependencies with the same `from`, `to` and `type` (`duplicate-dependency`);
- dependencies forming a cycle (`dependency-cycle`), whose message lists the identifiers on the cycle.

#### Scenario: ATimelineWithoutDependenciesIsValid
- **WHEN** a timeline declares no `dependencies`
- **THEN** it is valid, and no arrow is drawn

#### Scenario: ADependencyLinksAMilestoneToATask
- **WHEN** a dependency declares `from` a milestone's `id` and `to` a task's `id`, without a `type`
- **THEN** it is valid and read as `finish-to-start`, from the milestone's date to the task's earliest item

#### Scenario: AllFourGanttTypesAreAccepted
- **WHEN** four dependencies declare `finish-to-start`, `start-to-start`, `finish-to-finish` and `start-to-finish`
- **THEN** the document is valid, and each is drawn between the ends its type names

#### Scenario: AnUnknownDependencyTypeIsRefused
- **WHEN** a dependency declares `type: "lag"`
- **THEN** the document is refused, and the diagnostic names the four supported types

#### Scenario: AnUnresolvedEndpointIsRefused
- **WHEN** a dependency's `to` names an identifier no task or item declares
- **THEN** the document is refused with `unresolved-endpoint`, pointing at that `to`

#### Scenario: AnEmptyTaskCannotBeAnEndpoint
- **WHEN** a dependency names a task whose `items` is empty
- **THEN** the document is refused with `empty-task-endpoint`

#### Scenario: ASelfDependencyIsRefused
- **WHEN** a dependency links a task to one of its own items
- **THEN** the document is refused with `self-dependency`

#### Scenario: ADuplicateDependencyIsRefused
- **WHEN** two dependencies declare the same `from`, `to` and `type`
- **THEN** the document is refused with `duplicate-dependency`, pointing at the second

#### Scenario: ACycleIsRefused
- **WHEN** A depends on B, B on C and C on A
- **THEN** the document is refused with `dependency-cycle`, and the message names A, B and C

### Requirement: DependenciesAreDrawnBetweenTheEndsTheyLink

Each dependency SHALL be drawn as an arrow from the predecessor's end its type names (its finish for
`finish-to-*`, its start for `start-to-*`) to the successor's end its type names (its start for
`*-to-start`, its finish for `*-to-finish`), routed with horizontal and vertical segments, and pointing
at the successor. Arrows SHALL be drawn beneath annotations, so no label is hidden by one. A task
endpoint SHALL attach to its row at the task's span.

A dependency whose dates do not honour it SHALL still be drawn, marked distinctly as not satisfied.
A dependency SHALL be not satisfied when the successor's linked end falls on a strictly earlier day
than the predecessor's linked end; the same day SHALL count as satisfied. Not satisfying a dependency
SHALL NOT make the document invalid.

#### Scenario: AFinishToStartArrow
- **WHEN** activity A ends 2027-02-28 and activity B, starting 2027-03-01, depends on it finish-to-start
- **THEN** an arrow is drawn from A's finish to B's start, and it is shown as satisfied

#### Scenario: AStartToStartArrow
- **WHEN** B depends on A start-to-start
- **THEN** the arrow leaves A's start and points at B's start

#### Scenario: AnUnsatisfiedDependencyIsShownNotRefused
- **WHEN** B starts 2027-02-15 and depends finish-to-start on A, which ends 2027-02-28
- **THEN** the document is valid, and the arrow is drawn marked as not satisfied

#### Scenario: SameDayCountsAsSatisfied
- **WHEN** activity B starts on milestone M's date and depends on M finish-to-start
- **THEN** the dependency is shown as satisfied

#### Scenario: ArrowsDoNotHideLabels
- **WHEN** an arrow passes over an annotated milestone
- **THEN** the annotation is drawn above the arrow and stays readable

### Requirement: TheReaderMayHideDependencies

When a timeline declares dependencies, the reader SHALL be offered a control that hides and shows
their arrows. Hiding SHALL change only what is drawn: the document, the textual equivalent and the
dependencies listed when an item is selected SHALL be unaffected, and the timeline SHALL say that its
dependencies are hidden. A timeline that declares none SHALL offer no such control. Arrows SHALL be
shown when the timeline is first drawn.

#### Scenario: HidingDependenciesRemovesOnlyTheArrows
- **WHEN** the reader hides the dependencies of a timeline that declares three
- **THEN** no arrow is drawn, the timeline says its dependencies are hidden, and selecting an item still lists its dependencies

#### Scenario: ShowingThemAgainRestoresTheArrows
- **WHEN** the reader shows the dependencies again
- **THEN** every arrow is drawn as before

#### Scenario: NoControlWithoutDependencies
- **WHEN** a timeline declares no dependencies
- **THEN** no control to hide them is offered

### Requirement: TheReaderMayCompactSections

When a timeline has at least one separator with tasks under it, the reader SHALL be offered a control
that draws each section — a separator and the tasks that follow it up to the next separator — as one
row titled by the separator, and a control that returns to one row per task. One row per task SHALL
be the initial drawing. Compacting SHALL change only what is drawn: the document, the textual
equivalent, dependencies and item details SHALL be unaffected, and selecting an item SHALL still name
its task.

In a compacted row every item of the section's tasks SHALL be drawn on the same time axis, with the
same annotation and lane rules as a task row, so that no annotation overlaps another annotation, a
bar or a star. An activity with no label of its own SHALL be annotated with its task's label there,
since the row that named it is no longer drawn. Tasks before the first separator belong to no section
and SHALL keep their own rows.

#### Scenario: CompactingDrawsOneRowPerSection
- **WHEN** the reader compacts a timeline whose two sections hold two tasks each
- **THEN** each section is drawn as one row titled by its separator, holding every item of its tasks, with no annotation overlapping another annotation or a glyph

#### Scenario: CompactingChangesOnlyTheDrawing
- **WHEN** the reader compacts the timeline and selects an item
- **THEN** the details name the item's task, every dependency is still drawn between the same items, and the textual equivalent is unchanged

#### Scenario: AnUnlabelledActivityIsNamedByItsTaskWhenCompacted
- **WHEN** a compacted section holds an activity with no label
- **THEN** that activity is annotated with its task's label

#### Scenario: TasksBeforeTheFirstSeparatorKeepTheirRows
- **WHEN** a timeline with tasks before its first separator is compacted
- **THEN** those tasks keep one row each

#### Scenario: ExpandingRestoresOneRowPerTask
- **WHEN** the reader returns to one row per task
- **THEN** every task is drawn on its own row again

#### Scenario: NoCompactControlWithoutSections
- **WHEN** a timeline has no separator followed by a task
- **THEN** no control to compact it is offered

### Requirement: ATimelineIsNotAProposal

A timeline SHALL NOT name a `target` or declare `removals`; such a document SHALL be refused with
`kind-not-proposable`. A timeline SHALL NOT declare viewpoints; such a document SHALL be refused with
`viewpoints-without-graph`. Maintaining a timeline SHALL mean presenting the whole revised document
again.

#### Scenario: ATimelineWithATargetIsRefused
- **WHEN** a timeline names a target or declares removals
- **THEN** it is refused with `kind-not-proposable`, and nothing is offered for approval

#### Scenario: ATimelineWithViewpointsIsRefused
- **WHEN** a timeline declares viewpoints
- **THEN** it is refused with `viewpoints-without-graph`

### Requirement: TheTimeAxisIsProportionalToCalendarTime

The renderer SHALL derive every horizontal position from calendar dates, in days, so that equal
durations occupy equal widths wherever they fall: an activity lasting twice as many days as another
SHALL be drawn twice as wide, and a month of 31 days SHALL be wider than a month of 28. An activity
SHALL span from the start of its `start` day to the end of its `end` day; a milestone SHALL sit at the
middle of its day. This SHALL hold at every scale and at every fitted width.

The header SHALL name every year in the drawn range. Under the years it SHALL label a calendar unit,
with a reference line at each of its boundaries. At a chosen scale, that unit SHALL be the scale's own.
In a fitted drawing, it SHALL be the finest unit the density leaves wide enough to label:

- weeks, as ISO week numbers, under months instead of years;
- otherwise months;
- otherwise quarters.

Labels too narrow to read SHALL be shortened or left out; years SHALL never be left out. The width of
the drawing SHALL follow the scale and the declared range, not the viewport, except when fitted. No
maximum duration SHALL be imposed beyond the date format's own.

Positions SHALL NOT depend on the reader's time zone.

#### Scenario: EqualDurationsHaveEqualWidths
- **WHEN** one activity spans 90 days and another 180 days
- **THEN** the second bar is twice as wide as the first

#### Scenario: MonthsAreNotEqualColumns
- **WHEN** the axis covers February and March of a non-leap year
- **THEN** March's column is wider than February's in the ratio 31 to 28

#### Scenario: YearsAndMonthsAreLabelled
- **WHEN** a timeline spanning October 2026 to March 2028 is drawn at the month scale
- **THEN** the header names the years 2026, 2027 and 2028 over their months, and every month in the range is labelled

#### Scenario: WeeksAreNumbered
- **WHEN** a timeline spanning 1 March to 30 April 2027 is drawn at the week scale
- **THEN** the header names March and April 2027, labels the ISO weeks 9 to 17, and draws a line at each Monday

#### Scenario: QuartersAreLabelled
- **WHEN** a timeline spanning 2026 to 2028 is drawn at the quarter scale
- **THEN** the header names each year over its four quarters, and draws a line at each quarter's first day

#### Scenario: TheHeaderFollowsAFittedDensity
- **WHEN** a three-year timeline declaring `scale: "week"` is fitted into 900 pixels
- **THEN** its header labels quarters or months, not weeks, and every year is named

#### Scenario: TimeZoneDoesNotMovePositions
- **WHEN** the same timeline is drawn in two different reader time zones
- **THEN** every bar and milestone is at the same position in both

### Requirement: TasksAndSeparatorsAreDrawnAsRows

Every row SHALL be drawn in declaration order. A task SHALL be drawn as a labelled row; its
activities SHALL be drawn as horizontal bars and its milestones as stars on that row. A separator
SHALL be drawn as a horizontal divider across the whole timeline, showing its label as a group title
when it has one, and SHALL NOT affect the time axis.

#### Scenario: RowsKeepDeclarationOrder
- **WHEN** a timeline declares a separator, two tasks, another separator and a task
- **THEN** they are drawn top to bottom in that order

#### Scenario: ActivitiesAreBarsAndMilestonesAreStars
- **WHEN** a task holds one activity and one milestone
- **THEN** the activity is drawn as a horizontal bar and the milestone as a star

#### Scenario: SeparatorsDoNotMoveTheAxis
- **WHEN** a separator is added to a timeline
- **THEN** every bar and milestone keeps its horizontal position

### Requirement: ItemsAreAnnotatedWithTheirMeaning

A labelled activity SHALL show its `label` with its bar. A milestone SHALL show its `label`, or its
`kind` when it has no label. An item with neither SHALL show no annotation; the renderer SHALL NOT
invent one.

Annotations SHALL be placed so that, within a row, no annotation overlaps another annotation, a bar or
a star: an activity label that fits inside its bar SHALL be drawn inside it, otherwise beside it, and
the row SHALL grow additional lanes when annotations would otherwise collide. Each annotation SHALL
stay visibly associated with its item.

#### Scenario: AnActivityShowsItsLabel
- **WHEN** an activity declares `label: "Étude préliminaire"`
- **THEN** that text is drawn with its bar

#### Scenario: AMilestoneFallsBackToItsKind
- **WHEN** a milestone declares `kind: "SRR"` and no label
- **THEN** it is annotated `SRR`

#### Scenario: AnUnlabelledItemIsNotAnnotated
- **WHEN** an activity declares neither label nor kind
- **THEN** its bar is drawn with no text

#### Scenario: CrowdedAnnotationsDoNotOverlap
- **WHEN** three milestones on one task fall within a week of each other, each with a label
- **THEN** their three annotations are drawn without overlapping each other, any bar or any star

### Requirement: ItemKindsAreDistinguishable

Items sharing a `kind` SHALL be drawn alike, and items of different kinds SHALL be drawn
distinguishably, using the same per-vocabulary palette assignment the other kinds use, so that the
mapping from kind to appearance lives in the renderer and never in the data. When any item declares a
kind, a legend SHALL name each kind with its appearance. Items without a kind SHALL use a neutral
default.

#### Scenario: DifferentMilestoneKindsLookDifferent
- **WHEN** a timeline holds milestones of kinds `SRR`, `PDR` and `CDR`
- **THEN** each kind is drawn in a distinct colour, and the legend names all three

#### Scenario: TheSameKindLooksTheSameEverywhere
- **WHEN** milestones of kind `PDR` appear on two different tasks
- **THEN** both are drawn with the same appearance

### Requirement: TheCurrentDateIsShownFromTheRenderingContext

The renderer SHALL take the current date from the reader's own calendar at render time, never from the
document, and SHALL draw it as a vertical line spanning every row, labelled `Today`, distinguishable
from month reference lines, bars, stars and separators. It SHALL NOT be selectable as an item.

When the current date falls outside the declared range, the renderer SHALL NOT draw the line; it SHALL
instead show, at the corresponding edge of the axis header, a marker stating that today is before or
after the displayed range.

#### Scenario: TodayInsideTheRange
- **WHEN** a timeline spanning 2026-10-01 to 2028-03-31 is drawn on 2027-01-15
- **THEN** a line labelled `Today` is drawn at 2027-01-15 across every row

#### Scenario: TheSameDocumentShowsANewToday
- **WHEN** the same document is drawn again on a later date
- **THEN** the line is at that later date, with no change to the document

#### Scenario: TodayBeforeTheRange
- **WHEN** a timeline starting 2027-01-01 is drawn on 2026-10-03
- **THEN** no line is drawn, and the start edge of the header states that today is before the displayed range

#### Scenario: TodayAfterTheRange
- **WHEN** a timeline ending 2026-06-30 is drawn on 2026-10-03
- **THEN** no line is drawn, and the end edge of the header states that today is after the displayed range

### Requirement: AWideTimelineScrollsHorizontally

When the timeline is wider than its viewport, the reader SHALL be able to scroll it horizontally. The
axis header, the rows and the current-date line SHALL scroll together, so that every position stays
aligned with its date, and the task-label column SHALL stay in view while the time area scrolls.

#### Scenario: ScrollingKeepsTodayAligned
- **WHEN** a timeline wider than its viewport is scrolled horizontally
- **THEN** the `Today` line and every bar remain under the header dates they denote

#### Scenario: TaskLabelsStayInView
- **WHEN** the reader scrolls a wide timeline to its end
- **THEN** every task's label is still visible beside its row

### Requirement: AnItemCanBeInspected

The reader SHALL be able to select an activity or a milestone, with the pointer or the keyboard, and
see its task's label and identifier, its type, its date or dates, its label and kind when it
declares them, and the dependencies it takes part in — predecessors and successors, with their type
and whether each is satisfied. Selecting an item SHALL emphasise its dependency arrows. Each item
SHALL carry an accessible name stating the same facts. A task label MAY be selected the same way to
show the dependencies naming that task.

#### Scenario: SelectingAMilestoneShowsItsDetails
- **WHEN** the reader selects the `SRR` milestone of task `T1`
- **THEN** the details name task `T1` and its label, the type milestone, the date 2027-03-01, the label and the kind `SRR`

#### Scenario: SelectingAnItemShowsItsDependencies
- **WHEN** the reader selects an activity that is the successor of one dependency and the predecessor of another, one of them not satisfied
- **THEN** the details list both, with their types and which one is not satisfied, and both arrows are emphasised

#### Scenario: ItemsAreReachableFromTheKeyboard
- **WHEN** the reader moves focus through a timeline with the keyboard and confirms an item
- **THEN** that item's details are shown, as for a pointer selection

### Requirement: ATimelineTravelsLikeEveryOtherKind

A timeline SHALL be presentable through `present_structure` and through a structured-exchange block in
a reply, SHALL be refused there with the rule and pointer like any other kind, and SHALL be summarised
back to the agent by a digest counting its tasks, activities, milestones and dependencies, and naming
every dependency that is not satisfied. Its textual equivalent — the title, the range, each row with
its items' types, dates, labels and kinds in order, then each dependency with its type and whether it
is satisfied — and its raw JSON SHALL stay available to the reader.

A project profile SHALL NOT constrain a timeline in this change: a timeline is presented unconstrained,
as a sequence is.

`write_structure_figure` SHALL draw a timeline, as the `TheFigureWriterDrawsATimeline` requirement
specifies. `write_structure_table` SHALL refuse a timeline, saying that no table is written for one, and
SHALL write nothing.

#### Scenario: TheAgentPresentsATimeline
- **WHEN** the agent calls `present_structure` with a valid version 3 timeline
- **THEN** the interface draws it natively, and the tool result reports how many tasks, activities, milestones and dependencies it holds

#### Scenario: TheAgentIsToldOfUnsatisfiedDependencies
- **WHEN** the agent presents a timeline in which one dependency is not satisfied
- **THEN** the tool result names that dependency's endpoints and type as not satisfied

#### Scenario: ATimelineInAReplyIsDrawn
- **WHEN** a reply contains a structured-exchange block holding a valid timeline
- **THEN** the block is drawn as a timeline

#### Scenario: ARefusedTimelineIsExplained
- **WHEN** the agent presents a timeline with an inverted activity
- **THEN** the tool result names `inverted-range` and points at the activity, and nothing is drawn

#### Scenario: TheTextualEquivalentListsEveryItem
- **WHEN** the reader opens a timeline's textual equivalent
- **THEN** it lists every row in order, every item with its type, dates, label and kind, and every dependency with its type and whether it is satisfied

#### Scenario: TheFigureWriterRefusesATimeline
- **WHEN** the agent asks `write_structure_table` for a timeline
- **THEN** the tool refuses with a reason, and no file is written

### Requirement: ATimelineFigureIsTheReadersPicture

The system SHALL produce, without a browser, a self-contained SVG figure of a valid timeline: its title,
the task-label column, the year and month header, separators and section rows, every bar and star with its
annotation, the dependency arrows, the current-date line or out-of-range marker, and the legend. The figure
SHALL place every element where the reader's view places it for the same document, display options and
scale, and SHALL use the project's kind colours where the project declares them.

#### Scenario: AFigureHoldsEverythingTheReaderShows
- **WHEN** a figure is produced for a timeline with separators, activities, milestones and dependencies
- **THEN** the SVG holds every task label, separator title, bar, star, annotation, arrow and legend entry, and opens on its own

#### Scenario: TheFigureMatchesTheScreen
- **WHEN** the reader's view and a figure are drawn for the same timeline, options and date
- **THEN** every bar, star and arrow is at the same coordinates in both

#### Scenario: AFigureUsesProjectColours
- **WHEN** the project colours kind `SRR` and a figure is produced for a timeline with an `SRR` milestone
- **THEN** the star and its legend entry carry the declared colour

### Requirement: AWrittenFigureDatesItsReferenceLine

A figure written to a file or downloaded SHALL label the current-date line with the date it was drawn, not
"Today", because the file outlives that day. When that date is outside the timeline's range, the figure
SHALL draw no line and SHALL say, in its header, the date and which side of the range it is on. The figure
writer SHALL be able to omit the line altogether.

#### Scenario: AWrittenFigureNamesItsDate
- **WHEN** a figure of a timeline spanning 2026–2027 is written on 2026-10-03
- **THEN** its reference line is labelled `3 Oct 2026`, and no text in it reads `Today`

#### Scenario: TheReferenceLineCanBeOmitted
- **WHEN** the agent asks for a figure without the reference line
- **THEN** the figure draws no date line and no out-of-range marker

### Requirement: AFigureFitsAWidth

The figure writer SHALL accept a scale and a target width. With a scale and no width, the figure SHALL
draw time at that scale's density, labelled in its unit. With a width, the figure SHALL scale the time
axis so the whole figure, label column included, fits that width, whatever scale is asked. Durations
SHALL stay proportional, and annotations SHALL still not overlap one another or any glyph: rows grow
lanes as needed. The header of a fitted figure SHALL label the finest unit its density leaves room for,
never finer than a scale asked with the width, and every year SHALL stay labelled. Without either, the
figure SHALL use the scale the timeline declares.

#### Scenario: ALongPlanFitsAPage
- **WHEN** a figure of an 18-month timeline is written with a width of 900
- **THEN** the SVG is at most 900 wide, every year is labelled, and no annotation overlaps another or a glyph

#### Scenario: ProportionsSurviveScaling
- **WHEN** a figure is written with a width for a timeline with activities of 90 and 180 days
- **THEN** the second bar is twice as wide as the first

#### Scenario: AFigureAtTheQuarterScale
- **WHEN** a figure of a month-scale timeline is written with `scale: "quarter"` and no width
- **THEN** it is drawn at the quarter density with quarters in its header, as the reader draws that timeline at the quarter scale

### Requirement: TheReaderCanSaveATimelineFigure

The reader SHALL be offered, for a timeline, the same "download SVG" and "copy markup" controls a graph
has. The saved figure SHALL reflect the display options chosen at that moment: one row per section,
dependencies hidden, and the scale, at the density and header unit drawn on screen. A stretched or
fitted view SHALL be saved at the width it is drawn at. The saved
figure SHALL NOT carry a selection, a focus ring or other interaction state.

#### Scenario: TheDownloadedFigureFollowsTheDisplayOptions
- **WHEN** the reader switches to one row per section, hides the dependencies and downloads the SVG
- **THEN** the file draws one row per section and no arrow

#### Scenario: TheDownloadedFigureFollowsTheScale
- **WHEN** the reader switches to the quarter scale and downloads the SVG
- **THEN** the file is drawn as the screen draws it, with quarters in its header

#### Scenario: NoInteractionStateLeaves
- **WHEN** the reader selects an item and then copies the markup
- **THEN** the markup carries no selection emphasis, focus ring or details panel

### Requirement: TheFigureWriterDrawsATimeline

`write_structure_figure` SHALL draw a valid timeline to the path asked for. It SHALL take optional
parameters for:

- one row per section;
- hidden dependencies;
- a scale;
- a target width;
- omitting the reference line.

It SHALL tell the agent how to reference the file from Markdown, as it does for a graph. A timeline the
contract refuses SHALL be refused with its rule and pointer, and nothing SHALL be written.
`write_structure_table` SHALL still refuse a timeline.

#### Scenario: TheAgentWritesATimelineFigure
- **WHEN** the agent asks `write_structure_figure` for a valid timeline with `compact` and `width: 900`
- **THEN** an SVG is written at the path, drawn one row per section within 900 wide, and the result gives a Markdown image reference to it

#### Scenario: TheAgentChoosesAScale
- **WHEN** the agent asks `write_structure_figure` for a valid timeline with `scale: "week"`
- **THEN** the SVG is drawn at the week density with week numbers in its header

#### Scenario: AnInvalidTimelineWritesNothing
- **WHEN** the agent asks for a figure of a timeline with an inverted activity
- **THEN** the tool refuses with `inverted-range` and the pointer, and no file is written

#### Scenario: TheTableWriterStillRefusesATimeline
- **WHEN** the agent asks `write_structure_table` for a timeline
- **THEN** the tool refuses with a reason, and no file is written

### Requirement: ATimelineMayStateWhatItIsComparedWith

A version 3 timeline MAY declare `comparedTo`, an object with a `label` naming the previous plan and an
optional `date` (`YYYY-MM-DD`). When it does:

- an activity MAY declare `previous: { start, end }` and a milestone `previous: { date }` — where it stood
  in the previous plan;
- a task or an item MAY declare `role`, either `added` (absent from the previous plan) or `removed`
  (present in the previous plan, absent from this one, kept so it can be shown);
- an item with neither `previous` nor a `role` was unchanged, or could not be compared.

A timeline without `comparedTo` SHALL mean exactly what it means today, and SHALL NOT carry `previous` or
`role` anywhere. Comparison data SHALL be dates and roles only: never positions, colours or shapes.

#### Scenario: AComparedTimelineIsValid
- **WHEN** a timeline declares `comparedTo`, an activity with `previous` dates, an added milestone and a removed task
- **THEN** it is valid

#### Scenario: APlainTimelineIsUnchanged
- **WHEN** a timeline valid before comparisons existed is validated
- **THEN** it is valid and is drawn exactly as before

#### Scenario: PreviousDatesFollowTheItemShape
- **WHEN** a milestone declares `previous: { start, end }`
- **THEN** the document is refused at that `previous`

### Requirement: ComparisonDataIsCheckedAfterTheSchema

After schema validation the system SHALL refuse, naming the rule and pointing at the value:

- `previous` or `role` in a timeline without `comparedTo` (`comparison-without-reference`);
- `previous` on an item whose role is `added` or `removed`, or an item `role` contradicting its task's
  (`contradictory-change`);
- a `previous` date that is not a real day, or a `previous` activity that ends before it starts
  (`invalid-date`, `inverted-range`);
- a `previous` date outside the timeline's range (`item-outside-range`): the range covers both plans;
- a dependency naming a removed task or item (`dependency-on-removed`).

#### Scenario: ComparisonWithoutReferenceIsRefused
- **WHEN** an item declares `previous` in a timeline without `comparedTo`
- **THEN** the document is refused with `comparison-without-reference` at that `previous`

#### Scenario: AnAddedItemWithPreviousDatesIsRefused
- **WHEN** an item declares `role: "added"` and `previous`
- **THEN** the document is refused with `contradictory-change`

#### Scenario: PreviousDatesOutsideTheRangeAreRefused
- **WHEN** an activity's `previous` start is before `time.start`
- **THEN** the document is refused with `item-outside-range`

#### Scenario: ADependencyOnARemovedItemIsRefused
- **WHEN** a dependency names a removed milestone
- **THEN** the document is refused with `dependency-on-removed`

### Requirement: TheComparisonShowsWhatMoved

In the comparison view, the reader SHALL draw each changed activity at its current dates solid and at its
previous dates as a dashed outline on the same row, and each changed milestone as a solid star with a
hollow dashed star at its previous date. The annotation SHALL state the shift after the label, in
brackets and in italics so it is never read as part of the name: one amount when both ends moved alike
(`(+3w)`), the start's then the end's when they differ (`(+1w, end+4w)`), and a lone end named when only
one moved (`(end+4w)`, `(start+1w)`). Amounts SHALL be in days under two weeks, weeks under ten weeks,
months beyond, signed (`+3w`, `−2d`, `+3mo`). An added task or item SHALL be marked `(new)` the same way;
a removed one SHALL
be drawn dashed only, with its annotation struck through. The reference plan's label SHALL be shown above
the timeline, and the legend SHALL explain current, previous, new and removed. Annotations SHALL still not
overlap one another or any glyph, previous outlines included.

#### Scenario: ASlippedActivityShowsBothPositions
- **WHEN** an activity planned 2027-03-01 to 2027-06-30 now runs 2027-03-22 to 2027-07-21
- **THEN** a dashed outline is drawn at the previous dates and a solid bar at the current ones, annotated `(+3w)` in italics after its label

#### Scenario: AStretchedActivityShowsBothEnds
- **WHEN** an activity's start is unchanged and its end moved by four weeks
- **THEN** its annotation states `(end+4w)`, and the start is not mentioned

#### Scenario: AMovedMilestoneShowsWhereItWas
- **WHEN** a milestone moved from 2027-05-15 to 2027-06-01
- **THEN** a hollow dashed star is drawn at 2027-05-15, a solid star at 2027-06-01, annotated `(+2w)`

#### Scenario: AddedAndRemovedAreMarked
- **WHEN** a timeline holds an added milestone and a removed activity
- **THEN** the milestone is marked `(new)`, the activity is drawn dashed with its label struck through, and the legend explains both

#### Scenario: TheReferencePlanIsNamed
- **WHEN** a timeline declares `comparedTo: { label: "Plan of 1 September" }`
- **THEN** the view states it is compared with "Plan of 1 September"

### Requirement: TheReaderSwitchesBetweenComparisonAndNewVersion

A timeline that declares `comparedTo` SHALL be drawn first as the comparison, with a control to draw the
new version only — previous outlines, shift amounts, new marks and removed items left out, as if the
document carried no comparison — and back. The document SHALL NOT change.

#### Scenario: TheNewVersionOnlyLooksLikeAPlainPlan
- **WHEN** the reader chooses the new version only
- **THEN** the drawing equals the drawing of the same timeline with its comparison data removed

#### Scenario: BackToTheComparison
- **WHEN** the reader returns to the comparison
- **THEN** the previous outlines, shifts and marks are drawn again

### Requirement: TheReaderCanShowOnlyWhatMoved

In the comparison view the reader SHALL be able to show only the tasks that hold a change — a shift, an
addition or a removal — and the separators that head them; the timeline SHALL say how many tasks are
hidden. Dependencies to hidden items SHALL not be drawn.

#### Scenario: OnlyWhatMovedHidesUnchangedTasks
- **WHEN** a compared timeline has five tasks of which two hold changes, and the reader shows only what moved
- **THEN** two tasks are drawn under their separators, and the timeline says three are hidden

### Requirement: TheComparisonIsInTheWordsToo

The textual equivalent of a compared timeline SHALL name the reference plan and list, per task, every
shift with its previous and current dates and the amount, every addition and every removal. The digest
`present_structure` returns SHALL count shifted, added and removed items and name the largest slip.

#### Scenario: TheTextListsEveryChange
- **WHEN** the reader opens the textual equivalent of a compared timeline
- **THEN** it names the reference plan, and every shift, addition and removal with its dates

#### Scenario: TheAgentIsToldWhatMoved
- **WHEN** the agent presents a compared timeline
- **THEN** the result counts shifted, added and removed items and names the largest slip with its amount

### Requirement: TheAgentCanCompareTwoTimelines

The agent SHALL have a tool, `compare_timelines`, that reads a previous and a current timeline file from
the workspace, each valid on its own, and produces the comparison: the current timeline with `comparedTo`
(the label given, else the previous plan's title, else its file name), `previous` dates on every task item
paired by `id` whose dates differ, `role: "added"` on tasks and items whose `id` the previous plan lacks,
and the previous plan's tasks and items whose `id` the current plan lacks, carried as `role: "removed"`
under the matching task (or as a removed task). The range SHALL cover both plans. Items without an `id`
SHALL be left uncompared, and the tool SHALL say how many there were in each file.

The comparison SHALL be presented to the reader, and SHALL be written to an output path when one is given,
inside the writable zone. Neither input file SHALL be modified. An input that is not a valid timeline SHALL
be refused with its rule and pointer, and nothing presented or written.

#### Scenario: TheToolPairsByIdentifier
- **WHEN** the previous plan has milestone `srr` on 2027-03-01 and the current plan has `srr` on 2027-03-22
- **THEN** the comparison carries `srr` at 2027-03-22 with `previous: { date: "2027-03-01" }`

#### Scenario: TheToolCarriesRemovedItems
- **WHEN** the previous plan has an item `audit` the current plan lacks
- **THEN** the comparison carries `audit` with its previous dates and `role: "removed"`

#### Scenario: TheToolSaysWhatItCouldNotCompare
- **WHEN** the current plan holds two items without an `id`
- **THEN** the result says two items of the current plan could not be compared, and they carry no role or previous dates

#### Scenario: TheInputsStayPure
- **WHEN** the tool writes a comparison to an output path
- **THEN** both input files are byte-for-byte unchanged, and the output is a valid compared timeline

#### Scenario: AnInvalidInputIsRefused
- **WHEN** the previous file is not a valid timeline
- **THEN** the tool refuses with the rule and pointer, and nothing is presented or written

### Requirement: AComparisonLeavesAsAFigure

`write_structure_figure` SHALL accept `comparison: "compare" | "new"` for a compared timeline, defaulting
to `compare`, and the reader's download SHALL save the view on screen. The figure SHALL carry the
reference plan's label and the legend of the marks.

#### Scenario: TheAgentWritesTheComparedVersion
- **WHEN** the agent writes a figure of a compared timeline without the `comparison` parameter
- **THEN** the SVG holds the previous outlines, the shifts and the reference plan's label

#### Scenario: TheAgentWritesTheNewVersion
- **WHEN** the agent writes the same figure with `comparison: "new"`
- **THEN** the SVG holds no previous outline, shift or reference label

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

### Requirement: TheReaderChoosesTheScale

The reader SHALL open a timeline at the scale its `time.scale` declares. It SHALL offer a control to
draw it at `week`, `month` or `quarter`, or fitted to the visible width. Each scale SHALL draw time at
least at its own density, finest for `week` and coarsest for `quarter`, and its header SHALL label that
scale's unit. When the declared range at that density is narrower than the visible width, the timeline
SHALL be stretched to fill the width rather than leave it empty, still labelled in the chosen unit. A
fitted timeline SHALL draw the whole declared range within the visible width. It SHALL never be drawn
narrower than a legible minimum: below that minimum, the timeline scrolls. A stretched or fitted
timeline SHALL be redrawn to the new width when the view is resized.

The display options SHALL be shared by the timeline in the conversation and its enlarged view:

- the scale;
- one row per section;
- hidden dependencies;
- the comparison or the new version only;
- only what moved.

Opening, closing or using the enlarged view SHALL keep what the reader chose in either.

Changing scale SHALL change only what is drawn. The document, the textual equivalent, the selection, the
item details and the other display options SHALL be unaffected. When the scale changes and the timeline
still scrolls, the date that was at the middle of the visible width SHALL stay at the middle.

#### Scenario: TheTimelineOpensAtItsDeclaredScale
- **WHEN** a timeline declaring `scale: "week"` is opened
- **THEN** it is drawn at the week density, with week numbers in its header, and the control shows `week`

#### Scenario: AQuarterIsNarrowerThanAMonth
- **WHEN** the reader switches a three-year timeline from `month` to `quarter` in a view narrower than its quarter drawing
- **THEN** every bar is narrower in the ratio of the two densities, and an activity twice as long as another is still twice as wide

#### Scenario: AShortDrawingFillsTheView
- **WHEN** the reader chooses `quarter` for an 18-month timeline in a view wider than its quarter drawing
- **THEN** the timeline fills the visible width without scrolling, and its header still labels quarters

#### Scenario: TheEnlargedViewKeepsTheScale
- **WHEN** the reader chooses `quarter` and one row per section, then enlarges the timeline
- **THEN** the enlarged view is drawn at the quarter scale with one row per section

#### Scenario: AChoiceInTheEnlargedViewStays
- **WHEN** the reader chooses `week` in the enlarged view and closes it
- **THEN** the timeline in the conversation is drawn at the week scale

#### Scenario: FitShowsTheWholeRange
- **WHEN** the reader chooses fit for an 18-month timeline in a view narrower than its month drawing
- **THEN** the whole range is visible without scrolling, from its first day to its last

#### Scenario: FitFollowsTheView
- **WHEN** the reader chooses fit and the view is then made narrower
- **THEN** the timeline is redrawn to the new width, still without scrolling

#### Scenario: ChangingScaleKeepsTheMiddleDate
- **WHEN** the reader, with 15 June 2027 at the middle of the view, switches from `month` to `week`
- **THEN** 15 June 2027 is still at the middle of the view

#### Scenario: ChangingScaleKeepsTheSelection
- **WHEN** the reader selects an item and then changes scale
- **THEN** the same item is still selected and its details are unchanged

### Requirement: TheViewOpensOnWhatItIsAbout

When a timeline is first drawn wider than its view, the reader SHALL choose where it opens:

- a comparison drawn as a comparison SHALL open with its earliest change in view, whether that change
  is a shift, an addition or a removal, when that change would otherwise be outside the view;
- otherwise the view SHALL open on the current date when that date would be outside it, as before.

The rule SHALL apply once, when the timeline is first drawn. Afterwards the scroll position SHALL be the
reader's, except to keep the middle date when the scale changes.

#### Scenario: AComparisonOpensOnItsFirstChange
- **WHEN** a comparison whose every change lies months before the current date is opened in a narrow view
- **THEN** its earliest change is within the visible width

#### Scenario: APlainPlanOpensOnToday
- **WHEN** a timeline without a comparison is opened in a narrow view, with the current date late in its range
- **THEN** the current-date line is within the visible width

#### Scenario: TheReaderKeepsTheScroll
- **WHEN** the reader scrolls a timeline and then switches between the comparison and the new version only
- **THEN** the scroll position is not moved back
