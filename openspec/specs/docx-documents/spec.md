# docx-documents Specification

## Purpose
Lets the agent read a Word document the workspace already contains — its text, its headings and its
tables — without a shell, an external converter, or a guess about what the layout meant.

## Requirements

### Requirement: ExtractDocxContentTool

The system SHALL expose a tool that returns the content of a workspace `.docx` file as markdown.
The tool SHALL take the file's path, an optional block range, and a mode selecting text, tables, or
both.

Extraction SHALL read the document's own markup. The tool MUST NOT fetch anything over the network
to parse a file, MUST NOT follow references a document makes to external resources, and SHALL be
subject to the same path confinement as the other read tools: a path resolving — symlinks
included — outside the sandbox root SHALL be refused.

Output SHALL identify which block each piece of content came from, so a later call can name a range
and receive exactly it.

#### Scenario: ExtractTextFromDocx
- **WHEN** the tool is called on a Word document with mode `text`
- **THEN** it returns that document's text as markdown

#### Scenario: ExtractBlockRange
- **WHEN** the tool is called with a block range
- **THEN** only blocks in that range are returned, and blocks outside it are not read into the result

#### Scenario: PathOutsideSandbox
- **WHEN** the tool is called with a path that resolves outside the sandbox root
- **THEN** the call is refused with an access-denied error and no file is read

#### Scenario: NotADocx
- **WHEN** the tool is called on a file that is not a readable Word document
- **THEN** it returns an error naming that reason, not an empty result

#### Scenario: EncryptedDocx
- **WHEN** the document is password-protected
- **THEN** the tool reports that reason rather than returning the encrypted parts as text

### Requirement: DocxStructureIsRead, NotInferred

The system SHALL take a document's structure from its markup rather than from its appearance.
Heading paragraphs SHALL become markdown headings at the level the document assigns them, and a
table SHALL become a GitHub-flavoured markdown table with the rows and cells the document declares.

A cell's text SHALL NOT be able to alter the structure of the table it lands in: characters that
would end a cell or a row SHALL be escaped.

Because the structure is declared rather than reconstructed, the system SHALL NOT present tables as
approximate, and SHALL NOT require a separate mode to recover content a table reading might have
lost.

#### Scenario: HeadingsBecomeMarkdownHeadings
- **GIVEN** a document whose paragraphs carry heading levels
- **WHEN** it is extracted
- **THEN** those paragraphs are returned as markdown headings at the corresponding level

#### Scenario: TableBecomesMarkdownTable
- **GIVEN** a document containing a table
- **WHEN** it is extracted with mode `tables` or `both`
- **THEN** the table is returned as a markdown table with the rows and cells the document declares

#### Scenario: CellCannotBreakTheTable
- **GIVEN** a table cell whose text contains a pipe or a backslash
- **WHEN** the table is returned
- **THEN** every row still has the column count the document declares

#### Scenario: SingleCellTableIsLayout
- **GIVEN** a table declaring exactly one row with one cell — a cover page, a callout box
- **WHEN** the document is extracted
- **THEN** its content is returned as text rather than as a one-column table

#### Scenario: MixedDocument
- **GIVEN** a document with headings, paragraphs and a table
- **WHEN** it is extracted with mode `both`
- **THEN** all three are returned in the order they appear in the document

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

### Requirement: BoundedDocxExtraction

The system SHALL bound what one extraction call returns, so a large document cannot flood the
agent's context: a cap on blocks read per call and a cap on the size of the returned markdown. When
a cap truncates the result, the output SHALL say so, name the blocks actually covered, and state
how to request the rest.

Extraction SHALL also be bounded before parsing begins: a file above the configured size ceiling
SHALL be refused without being opened, and the total decompressed size, the number of entries, and
the wall-clock time SHALL each be capped while reading. A document that exceeds any of them SHALL
fail with a message naming that reason rather than exhausting the process.

#### Scenario: LongDocumentTruncated
- **GIVEN** a document far larger than the per-call output cap
- **WHEN** the tool is called without a range
- **THEN** it returns the covered blocks, states that the result was truncated, and names the remaining range

#### Scenario: OversizeFileRefused
- **GIVEN** a file above the configured size ceiling
- **WHEN** the tool is called on it
- **THEN** it is refused with a message naming the limit, and the file is not parsed

#### Scenario: CompressionBombRefused
- **GIVEN** a file whose parts expand far beyond their compressed size
- **WHEN** the tool reads it
- **THEN** extraction stops at the decompression cap and reports that reason

#### Scenario: ParsingExceedsBudget
- **WHEN** a document cannot be parsed within the time budget
- **THEN** the call fails with a message naming that reason and the session stays responsive

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

### Requirement: WordWholeDocumentExtraction

Word extraction SHALL offer whole-document extraction and extraction to a file on the same terms as
PDF extraction — the same absolute ceiling, the same time budget, the same writable-zone rule, and
the same refusal to overwrite an existing path.

Stating it here rather than sharing one requirement keeps each capability's spec readable on its
own; the behaviour is deliberately identical, and a difference between the two tools would be a
defect rather than a feature.

#### Scenario: WholeWordDocumentInOneCall
- **GIVEN** a Word document longer than the per-call block cap
- **WHEN** whole-document extraction is requested
- **THEN** every block is returned in that one call, with no truncation note

#### Scenario: WriteWholeWordExtractionToFile
- **GIVEN** a destination inside the writable zone
- **WHEN** Word extraction is requested with it
- **THEN** the whole extraction is written there, and the call returns the path, the coverage and an excerpt rather than the content

#### Scenario: WordDestinationRefused
- **WHEN** the destination is outside the writable zone, writing is disabled, or a file is already there
- **THEN** it is refused for that reason and nothing is written

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

### Requirement: PicturesAreMarkedWhereTheySit

Extraction SHALL place a marker in the returned markdown at each picture's position in the document's
flow, so that a reader of the extraction learns a picture is there without having to ask. A picture
dropped without a trace is the failure this requirement exists to remove: a caller summarising a
report cannot know it missed the chart the report was written around.

Each marker SHALL name the picture's format and its pixel dimensions, and SHALL carry the picture's
alternative text when the document holds one. It SHALL carry a stable identifier that the same call's
image parameter accepts, so that a caller can ask for one particular picture rather than all of them.

A marker SHALL be placed for a picture whose bytes the system cannot return — an unsupported vector
format, a part that is missing or unreadable — and SHALL say which of those it is. Silence about a
picture the document contains is never correct, whatever the reason the bytes are unavailable.

#### Scenario: PictureIsMarkedInPlace
- **GIVEN** a document with a paragraph, an embedded PNG and a following paragraph
- **WHEN** it is extracted
- **THEN** the markdown holds a marker between the two paragraphs naming the format and dimensions, and the paragraphs keep their order

#### Scenario: AlternativeTextIsCarried
- **GIVEN** a picture whose document declares alternative text
- **WHEN** the document is extracted
- **THEN** the marker carries that text

#### Scenario: UnreadablePictureIsStillNamed
- **GIVEN** a document embedding a picture in a format whose bytes cannot be returned as an image
- **WHEN** it is extracted
- **THEN** a marker states that the picture is present and why its bytes are not available, and the extraction otherwise succeeds

#### Scenario: DocumentWhoseOnlyContentIsAPicture
- **WHEN** a readable document yields no text, headings or tables, but does hold a picture
- **THEN** the result marks the picture rather than reporting the document as having no extractable content

### Requirement: PictureBytesOnlyWhenAsked

Extraction SHALL return picture bytes only when the call asks for them. The default SHALL return
markers alone, so that the cost of extracting a document stays predictable and proportional to its
text — an existing caller MUST NOT start receiving image bytes it did not request.

When pictures are asked for, the system SHALL return them as image content alongside the markdown,
and SHALL apply a bound on both their number and their total bytes. Where the bound is reached the
answer SHALL say how many pictures were left, and SHALL name how to ask for them — the same
obligation the extraction already carries for truncated text.

A vector picture SHALL be rasterised to a viewable image where the system can do so. Where it cannot,
its bytes SHALL be omitted and its marker SHALL say so; the call SHALL NOT fail because one picture
among several could not be prepared.

#### Scenario: NoPictureBytesByDefault
- **WHEN** a document holding pictures is extracted without asking for them
- **THEN** the result holds the markers and no image content

#### Scenario: PicturesReturnedOnRequest
- **GIVEN** a document holding two pictures
- **WHEN** the extraction is asked for its pictures
- **THEN** the result holds the markdown and both pictures as image content, each matching the identifier on its marker

#### Scenario: OnePictureByIdentifier
- **GIVEN** an extraction whose markers carry identifiers
- **WHEN** a later call asks for one of those identifiers
- **THEN** only that picture's bytes are returned

#### Scenario: BudgetIsStatedNotSilent
- **GIVEN** a document holding more picture bytes than one call returns
- **WHEN** its pictures are asked for
- **THEN** the pictures within the bound are returned, and the answer says how many were left and how to ask for them

#### Scenario: OneUnpreparablePictureDoesNotFailTheCall
- **GIVEN** a document holding one picture that can be returned and one that cannot
- **WHEN** its pictures are asked for
- **THEN** the first is returned, the second's marker says why it is not, and the call succeeds

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
