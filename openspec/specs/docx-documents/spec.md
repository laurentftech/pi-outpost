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

The system SHALL return the document as its author's latest revision reads it: text marked as a
tracked insertion SHALL be included, and text marked as a tracked deletion SHALL NOT be. Deleted
text MUST NOT reach the caller by any mode or option.

#### Scenario: TrackedInsertionIsKept
- **GIVEN** a document with a tracked insertion
- **WHEN** it is extracted
- **THEN** the inserted text is present

#### Scenario: TrackedDeletionIsDropped
- **GIVEN** a document with a tracked deletion
- **WHEN** it is extracted in any mode
- **THEN** the deleted text is absent from the result

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

#### Scenario: DocumentWithNoBodyText
- **WHEN** a readable document yields no text, headings or tables
- **THEN** the tool says the document has no extractable body content, and names what it does not read

#### Scenario: ContentOutsideTheBody
- **GIVEN** a document whose text sits only in headers, footers, footnotes or comments
- **WHEN** it is extracted
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
- **WHEN** it is extracted in any mode
- **THEN** the struck run is returned as a marked span and the tracked deletion is absent
