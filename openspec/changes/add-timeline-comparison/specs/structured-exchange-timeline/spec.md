# Spec Delta

## ADDED Requirements

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
hollow dashed star at its previous date. The annotation SHALL state the shift — start and end for an
activity whose duration changed, one amount otherwise — in days under two weeks, weeks under ten weeks,
months beyond, signed (`+3 wk`, `−2 d`). An added task or item SHALL be marked as new; a removed one SHALL
be drawn dashed only, with its annotation struck through. The reference plan's label SHALL be shown above
the timeline, and the legend SHALL explain current, previous, new and removed. Annotations SHALL still not
overlap one another or any glyph, previous outlines included.

#### Scenario: ASlippedActivityShowsBothPositions
- **WHEN** an activity planned 2027-03-01 to 2027-06-30 now runs 2027-03-22 to 2027-07-21
- **THEN** a dashed outline is drawn at the previous dates and a solid bar at the current ones, annotated `+3 wk`

#### Scenario: AStretchedActivityShowsBothEnds
- **WHEN** an activity's start is unchanged and its end moved by four weeks
- **THEN** its annotation states the end moved `+4 wk` and the start did not

#### Scenario: AMovedMilestoneShowsWhereItWas
- **WHEN** a milestone moved from 2027-05-15 to 2027-06-01
- **THEN** a hollow dashed star is drawn at 2027-05-15, a solid star at 2027-06-01, annotated `+2 wk`

#### Scenario: AddedAndRemovedAreMarked
- **WHEN** a timeline holds an added milestone and a removed activity
- **THEN** the milestone is marked new, the activity is drawn dashed with its label struck through, and the legend explains both

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
