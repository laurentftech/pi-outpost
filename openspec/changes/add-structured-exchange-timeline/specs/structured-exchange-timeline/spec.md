# Spec Delta

## Purpose

Lets an agent carry a project schedule — tasks, activities, milestones and group separators on a
calendar axis — as validated structured-exchange data that the interface draws natively, with the
reader's own current date shown against the plan, so the schedule can be maintained as data rather
than redrawn as a picture.

## ADDED Requirements

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
`title` and `dependencies`. `time` SHALL declare `start` and `end` as calendar dates written `YYYY-MM-DD`, and `scale`,
whose only supported value is `month`.

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

#### Scenario: AnUnsupportedScaleIsRefused
- **WHEN** a timeline declares a `scale` other than `month`
- **THEN** it is refused, and the diagnostic names the supported value

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
middle of its day.

The axis SHALL show a year header and a month header for the declared range, with a reference line at
each month boundary. The width of the drawing SHALL grow with the declared range rather than squeezing
it into the viewport, and no maximum duration SHALL be imposed beyond the date format's own.

Positions SHALL NOT depend on the reader's time zone.

#### Scenario: EqualDurationsHaveEqualWidths
- **WHEN** one activity spans 90 days and another 180 days
- **THEN** the second bar is twice as wide as the first

#### Scenario: MonthsAreNotEqualColumns
- **WHEN** the axis covers February and March of a non-leap year
- **THEN** March's column is wider than February's in the ratio 31 to 28

#### Scenario: YearsAndMonthsAreLabelled
- **WHEN** a timeline spanning October 2026 to March 2028 is drawn
- **THEN** the header names the years 2026, 2027 and 2028 over their months, and every month in the range is labelled

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

`write_structure_figure` and `write_structure_table` SHALL refuse a timeline, saying that no figure or
table is written for one, and SHALL write nothing.

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
- **WHEN** the agent asks `write_structure_figure` or `write_structure_table` for a timeline
- **THEN** the tool refuses with a reason, and no file is written
