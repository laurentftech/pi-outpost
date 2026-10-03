# Spec Delta

## ADDED Requirements

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

## MODIFIED Requirements

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
