# Spec Delta

## MODIFIED Requirements

### Requirement: AcceptedTextOnly

By default the system SHALL return the document as its author's latest revision reads it: text
marked as a tracked insertion SHALL be included, and text marked as a tracked deletion SHALL NOT be.
Deleted text MUST NOT reach the caller by any mode or option other than the review reading, which
the caller asks for explicitly.

A tracked move SHALL be read as its result: the moved text SHALL appear once, at its destination,
and not also at its origin. A table row deleted with tracking SHALL NOT be returned, rather than
returned as a row of empty cells.

A tracked formatting change keeps the formatting it replaced. That previous formatting SHALL NOT be
read as the run's or the paragraph's current formatting: a paragraph whose style was changed with
tracking SHALL be read with its current style, and a run whose strikethrough, bold or italic was
changed with tracking SHALL be marked by its current formatting only.

#### Scenario: TrackedInsertionIsKept
- **GIVEN** a document with a tracked insertion
- **WHEN** it is extracted
- **THEN** the inserted text is present

#### Scenario: TrackedDeletionIsDropped
- **GIVEN** a document with a tracked deletion
- **WHEN** it is extracted in any mode, without the review reading
- **THEN** the deleted text is absent from the result

#### Scenario: MovedTextAppearsOnce
- **GIVEN** a document in which a sentence was moved with tracking
- **WHEN** it is extracted without the review reading
- **THEN** the sentence appears exactly once, at its destination

#### Scenario: DeletedTableRowIsDropped
- **GIVEN** a table one of whose rows was deleted with tracking
- **WHEN** the document is extracted without the review reading
- **THEN** the table is returned without that row, and the other rows keep their cells

#### Scenario: PreviousParagraphStyleIsNotRead
- **GIVEN** a paragraph restyled with tracking from a heading style to a body style
- **WHEN** the document is extracted
- **THEN** the paragraph is returned as body text, not as a heading

#### Scenario: PreviousRunFormattingIsNotRead
- **GIVEN** a run whose strikethrough was removed with tracking
- **WHEN** the document is extracted
- **THEN** the run's text is returned unmarked

### Requirement: ReportEmptyDocument

The system SHALL distinguish a document it read successfully but found no body text in — an empty
file, or one whose content lives entirely in parts this change does not read — from a failure to
read it. It MUST NOT return an empty or whitespace-only result as though the document were simply
blank.

Comments are read only in the review reading. The parts named as not read SHALL therefore include
comments in the default reading, and SHALL NOT include them in the review reading.

#### Scenario: DocumentWithNoBodyText
- **WHEN** a readable document yields no text, headings or tables
- **THEN** the tool says the document has no extractable body content, and names what it does not read

#### Scenario: ContentOutsideTheBody
- **GIVEN** a document whose text sits only in headers, footers, footnotes or comments
- **WHEN** it is extracted without the review reading
- **THEN** the result says those parts are not read, rather than reporting an empty document

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

Markers alone are not enough to be noticed. When a document crosses anything out, the extraction
SHALL say so *before* the content, naming how many passages are struck and what the markers mean, so
a reader that works top to bottom cannot answer from the text without having read the warning. A
document that crosses nothing out SHALL carry no such line.

#### Scenario: StruckTextIsAnnouncedBeforeTheContent
- **GIVEN** a document containing struck-through runs
- **WHEN** it is extracted
- **THEN** the result opens with a line saying how many passages are struck out and what the markers mean, before any of the document's own text

#### Scenario: NothingStruckAnnouncesNothing
- **GIVEN** a document that crosses nothing out
- **WHEN** it is extracted
- **THEN** the result carries no such line

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
- **WHEN** it is extracted in any mode, without the review reading
- **THEN** the struck run is returned as a marked span and the tracked deletion is absent

#### Scenario: StrikethroughIsNotATrackedDeletionInReview
- **GIVEN** a document containing both a manually struck run and a tracked deletion
- **WHEN** it is extracted with the review reading
- **THEN** the struck run is returned wrapped in `~~` and the tracked deletion in a deletion marker, so the two cannot be confused

## ADDED Requirements

### Requirement: ReviewReadingMarksRevisions

The tool SHALL take an opt-in parameter asking for the review reading. In it, each tracked
insertion, deletion and move SHALL be returned where it sits: insertions as `{++text++}`, deletions
as `{--text--}`, each followed by a reference `[rN]`. A move SHALL be marked at both ends with one
shared reference `[mN]`. Tracked formatting changes SHALL NOT be marked.

#### Scenario: InsertionAndDeletionAreMarkedInPlace
- **GIVEN** a paragraph in which "30" was deleted and "45" inserted with tracking
- **WHEN** it is extracted with the review reading
- **THEN** the paragraph reads `{--30--}[r1]{++45++}[r2]` at that position, with the rest of the paragraph unmarked

#### Scenario: MoveIsMarkedAtBothEnds
- **GIVEN** a sentence moved with tracking from one section to another
- **WHEN** the document is extracted with the review reading
- **THEN** the sentence appears in a deletion marker at its origin and in an insertion marker at its destination, both carrying the same `[mN]` reference

#### Scenario: AdjacentRunsOfOneRevisionBecomeOneMarker
- **GIVEN** an insertion split across several runs with the same author and date
- **WHEN** it is extracted with the review reading
- **THEN** it is returned as one insertion marker with one reference

#### Scenario: FormattingChangeIsNotMarked
- **GIVEN** a document whose only tracked change is a run made bold
- **WHEN** it is extracted with the review reading
- **THEN** no revision marker appears, and the run is marked bold as its current formatting says

#### Scenario: RevisionInATableCell
- **GIVEN** a table cell holding a tracked insertion
- **WHEN** the table is returned with the review reading
- **THEN** the cell shows the insertion marker, and every row still has the column count the document declares

#### Scenario: DeletedTableRowIsKeptInReview
- **GIVEN** a table one of whose rows was deleted with tracking
- **WHEN** the document is extracted with the review reading
- **THEN** the row is returned, with its text in deletion markers

#### Scenario: DefaultReadingIsUnchanged
- **GIVEN** a document with tracked insertions, deletions and moves
- **WHEN** it is extracted without the review reading
- **THEN** no revision marker appears and no deleted text is returned

### Requirement: ReviewReadingAnchorsComments

In the review reading, each comment SHALL be marked on the text it is anchored to, as `{==text==}`
followed by a reference `[cN]`. A comment anchored to a point rather than a range SHALL be marked by
its reference alone. Comments are read from the document's own parts; nothing is fetched.

#### Scenario: CommentIsMarkedOnItsText
- **GIVEN** a comment anchored to the words "45 jours"
- **WHEN** the document is extracted with the review reading
- **THEN** those words are returned as `{==45 jours==}` followed by the comment's reference

#### Scenario: CommentOverARevision
- **GIVEN** a comment anchored to text that is also a tracked insertion
- **WHEN** the document is extracted with the review reading
- **THEN** both markers are present and both references are given, so neither hides the other

#### Scenario: CommentsAreNotReadByDefault
- **GIVEN** a document holding comments
- **WHEN** it is extracted without the review reading
- **THEN** no comment text and no comment marker appears in the result

### Requirement: ReviewReadingListsEveryReference

The review reading SHALL end with a list holding one entry per reference marked in the returned
content, in document order. Each entry SHALL give the reference, its kind, its author and date when
the document records them, and the headings it falls under. A comment's entry SHALL also give its
text, its replies in order, and whether it is resolved.

#### Scenario: RevisionEntryNamesAuthorDateAndSection
- **GIVEN** a tracked insertion under the heading "Performances", itself under "Exigences"
- **WHEN** the document is extracted with the review reading
- **THEN** the list entry for its reference gives the kind, the author, the date and both headings

#### Scenario: CommentEntryCarriesItsThread
- **GIVEN** a comment with two replies, marked resolved
- **WHEN** the document is extracted with the review reading
- **THEN** its entry gives the comment's text and author, both replies in order with their authors, and states it is resolved

#### Scenario: MissingAuthorOrDateIsNotInvented
- **GIVEN** a tracked change whose markup records no author and no date
- **WHEN** the document is extracted with the review reading
- **THEN** its entry says they are not recorded, rather than giving empty or made-up values

#### Scenario: ReviewOfADocumentWithNoReviewLayer
- **GIVEN** a document with no tracked change and no comment
- **WHEN** it is extracted with the review reading
- **THEN** the result is its accepted text and says the document holds no tracked change or comment

### Requirement: ReviewReferencesAreStableAcrossCalls

Reference numbers SHALL be assigned over the whole document, not over the blocks returned, so that
a reference keeps its number whichever block range or cap produced it. A truncated review reading
SHALL list only the references in the blocks it returned.

#### Scenario: SameReferenceInARangedCall
- **GIVEN** a document whose third tracked change sits in block 30
- **WHEN** block "30" is extracted with the review reading
- **THEN** that change carries the reference `[r3]`, as it does in a whole-document review reading

#### Scenario: TruncatedReviewListsOnlyWhatItShows
- **GIVEN** a review reading truncated by the per-call cap
- **WHEN** the result is returned
- **THEN** its list holds the references in the returned blocks and no others, and the truncation note names the blocks left

### Requirement: ReviewMarkersCannotBeForged

In the review reading, text that the document itself contains SHALL NOT be able to read as a review
marker or a reference: character sequences that would open or close a marker, or form a reference,
SHALL be escaped.

#### Scenario: DocumentTextLookingLikeAMarker
- **GIVEN** a paragraph whose own text is `{++approuvé++}[r1]`
- **WHEN** the document is extracted with the review reading
- **THEN** that text is returned escaped, and no revision or reference is reported for it

### Requirement: ReviewReadingIsAnnouncedBeforeTheContent

The review reading SHALL open, before the document's text, with a line stating how many tracked
changes and comments the returned content marks and what each marker means.

#### Scenario: ReviewLegendLeads
- **GIVEN** a document with three tracked changes and one comment
- **WHEN** it is extracted with the review reading
- **THEN** the result opens with a line giving those counts and the meaning of `{++ ++}`, `{-- --}`, `{== ==}` and the references

### Requirement: DefaultReadingAnnouncesTheReviewLayer

When a document holds tracked insertions, deletions, moves or comments, the default reading SHALL
say so in one line before the content, giving their counts over the whole document and naming the
parameter that shows them. A document holding none, or only tracked formatting changes, SHALL carry
no such line.

#### Scenario: HintNamesTheParameter
- **GIVEN** a document with tracked changes and comments
- **WHEN** it is extracted without the review reading
- **THEN** the result opens with a line giving their counts and naming the review parameter

#### Scenario: NoReviewLayerNoHint
- **GIVEN** a document whose only tracked changes are formatting changes
- **WHEN** it is extracted without the review reading
- **THEN** the result carries no such line

### Requirement: ReviewReadingNeverWrites

The review reading SHALL be read-only: it SHALL NOT accept, reject, resolve or alter any revision or
comment, and the source document SHALL be byte-identical after any extraction.

#### Scenario: SourceUnchangedAfterReview
- **GIVEN** a document with tracked changes and comments
- **WHEN** it is extracted with the review reading, to the answer and to an output file
- **THEN** the source file's bytes are unchanged
