## ADDED Requirements

### Requirement: RunFormattingIsCarriedIntoMarkdown

Crossing text out is a statement about the content, not a decoration: it says the text no longer
applies. The system SHALL therefore carry a run's strikethrough into the extracted markdown as a
GitHub-flavoured strikethrough span, so a struck sentence cannot reach the caller reading as live
content.

Bold and italic runs SHALL likewise be carried across as markdown emphasis. Underline SHALL NOT be:
GitHub-flavoured markdown has no underline, and a document that underlines a line instead of
styling it as a heading has declared no structure the system may invent.

A run whose formatting is switched off by an explicit false value SHALL be treated as unformatted,
because a run may inherit formatting it then turns off. Formatting declared on a paragraph mark
SHALL NOT be applied to the paragraph's runs.

Markers SHALL be emitted so that the surrounding markdown still parses: consecutive runs sharing
the same formatting SHALL produce one span rather than several adjacent ones, leading and trailing
whitespace SHALL fall outside the markers, and a run with no visible text SHALL produce no markers
at all.

Formatting SHALL NOT change what text is returned. It adds markers around text the system already
returned; it never adds, drops or reorders content.

#### Scenario: StruckRunIsMarked
- **GIVEN** a paragraph whose middle run is struck through
- **WHEN** the document is extracted
- **THEN** that run's text is returned wrapped in `~~`, and the rest of the paragraph is unmarked

#### Scenario: DoubleStrikeIsMarked
- **GIVEN** a run carrying a double strikethrough
- **WHEN** the document is extracted
- **THEN** its text is returned wrapped in `~~`, the same as a single strikethrough

#### Scenario: FormattingTurnedOffIsNotMarked
- **GIVEN** a run declaring strikethrough with an explicit false value
- **WHEN** the document is extracted
- **THEN** its text is returned unmarked

#### Scenario: BoldAndItalicAreMarked
- **GIVEN** a paragraph with a bold run and an italic run
- **WHEN** the document is extracted
- **THEN** the bold run is returned wrapped in `**` and the italic run wrapped in `*`

#### Scenario: UnderlineIsNotMarked
- **GIVEN** a paragraph whose runs are underlined
- **WHEN** the document is extracted
- **THEN** the text is returned unmarked, and the paragraph is not promoted to a heading

#### Scenario: CombinedFormattingNestsWithoutAmbiguity
- **GIVEN** a run that is struck through and bold at once
- **WHEN** the document is extracted
- **THEN** the text is returned with both markers, nested in a fixed order that parses as one struck, bold span

#### Scenario: AdjacentRunsWithTheSameFormattingBecomeOneSpan
- **GIVEN** a sentence split across several runs that are all struck through
- **WHEN** the document is extracted
- **THEN** the sentence is returned as a single `~~`-delimited span rather than one span per run

#### Scenario: WhitespaceStaysOutsideTheMarkers
- **GIVEN** a struck run whose text begins or ends with a space
- **WHEN** the document is extracted
- **THEN** the space is returned outside the markers, so the span still renders as struck through

#### Scenario: RunWithNoVisibleTextEmitsNoMarkers
- **GIVEN** a struck run containing only whitespace, or no text at all
- **WHEN** the document is extracted
- **THEN** no markers appear in the result

#### Scenario: ParagraphMarkFormattingDoesNotReachTheRuns
- **GIVEN** a paragraph whose paragraph mark declares strikethrough while its runs do not
- **WHEN** the document is extracted
- **THEN** the paragraph's text is returned unmarked

#### Scenario: MarkedTextInATableCell
- **GIVEN** a table cell containing a struck run
- **WHEN** the table is returned as a markdown table
- **THEN** the cell shows the struck span, and every row still has the column count the document declares

#### Scenario: StrikethroughIsNotATrackedDeletion
- **GIVEN** a document containing both a manually struck run and a tracked deletion
- **WHEN** it is extracted in any mode
- **THEN** the struck run is returned as a marked span and the tracked deletion is absent
