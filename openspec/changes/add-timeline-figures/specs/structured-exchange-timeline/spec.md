# Spec Delta

## ADDED Requirements

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

The figure writer SHALL accept a target width, and SHALL then scale the time axis so the whole figure,
label column included, fits that width. Durations SHALL stay proportional, annotations SHALL still not
overlap one another or any glyph — rows grow lanes as needed — and month labels too narrow to read SHALL be
shortened or left out while every year stays labelled. Without a width, the figure SHALL use the reader's
scale.

#### Scenario: ALongPlanFitsAPage
- **WHEN** a figure of an 18-month timeline is written with a width of 900
- **THEN** the SVG is at most 900 wide, every year is labelled, and no annotation overlaps another or a glyph

#### Scenario: ProportionsSurviveScaling
- **WHEN** a figure is written with a width for a timeline with activities of 90 and 180 days
- **THEN** the second bar is twice as wide as the first

### Requirement: TheReaderCanSaveATimelineFigure

The reader SHALL be offered, for a timeline, the same "download SVG" and "copy markup" controls a graph
has. The saved figure SHALL reflect the display options chosen at that moment — one row per section,
dependencies hidden — and SHALL NOT carry a selection, a focus ring or other interaction state.

#### Scenario: TheDownloadedFigureFollowsTheDisplayOptions
- **WHEN** the reader switches to one row per section, hides the dependencies and downloads the SVG
- **THEN** the file draws one row per section and no arrow

#### Scenario: NoInteractionStateLeaves
- **WHEN** the reader selects an item and then copies the markup
- **THEN** the markup carries no selection emphasis, focus ring or details panel

### Requirement: TheFigureWriterDrawsATimeline

`write_structure_figure` SHALL draw a valid timeline to the path asked for, with optional parameters for
one row per section, hidden dependencies, a target width and omitting the reference line, and SHALL tell
the agent how to reference the file from Markdown, as it does for a graph. A timeline the contract refuses
SHALL be refused with its rule and pointer, and nothing SHALL be written. `write_structure_table` SHALL
still refuse a timeline.

#### Scenario: TheAgentWritesATimelineFigure
- **WHEN** the agent asks `write_structure_figure` for a valid timeline with `compact` and `width: 900`
- **THEN** an SVG is written at the path, drawn one row per section within 900 wide, and the result gives a Markdown image reference to it

#### Scenario: AnInvalidTimelineWritesNothing
- **WHEN** the agent asks for a figure of a timeline with an inverted activity
- **THEN** the tool refuses with `inverted-range` and the pointer, and no file is written

#### Scenario: TheTableWriterStillRefusesATimeline
- **WHEN** the agent asks `write_structure_table` for a timeline
- **THEN** the tool refuses with a reason, and no file is written

## MODIFIED Requirements

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
