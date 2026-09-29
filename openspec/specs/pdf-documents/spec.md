# pdf-documents Specification

## Purpose
Makes a workspace PDF readable by both parties: the user sees it rendered in the file viewer
instead of a "binary file" refusal, and the agent can pull its text and tables out as markdown
through a tool, without a shell and without an external binary.
## Requirements
### Requirement: DisplayPdfInViewer

The system SHALL render a selected `.pdf` workspace file in the file viewer, instead of reporting
it as unpreviewable binary content. Rendering SHALL happen in the client from the file's bytes; a
workspace PDF MUST NOT be served in a way that lets it render or execute in the server's own
origin.

The document SHALL be read by scrolling, continuously, one page after another — the way a PDF is
read. Every page SHALL occupy its own height in the scroll from the moment the document opens, so
the scrollbar measures the document rather than the part of it already drawn. The page indicator
SHALL follow the scroll.

The viewer SHALL show the current page number and the page count, SHALL let the user jump between
pages and change zoom, and SHALL keep those controls reachable by keyboard. Only pages at or near
the viewport SHALL hold a rendering: opening a long document must not rasterize pages nobody has
looked at, and scrolling past a page SHALL release it.

The displayed page SHALL carry the document's own text, positioned over the rendering, so the text
can be selected and copied — a rendered page alone is an image, and an image of text is not text.
Failing to place that text SHALL cost selection only: the page stays displayed.

A failure inside the viewer SHALL stay inside the viewer. It MUST NOT unmount the surrounding
application or leave the user on a blank page.

#### Scenario: OpenPdfFromTree
- **WHEN** the user selects a `.pdf` file in the file tree
- **THEN** the file viewer displays its first page, with the page count and page controls, and no binary-file error

#### Scenario: ScrollThroughTheDocument
- **GIVEN** a displayed multi-page PDF
- **WHEN** the user scrolls
- **THEN** the following pages come into view without any further action, and the page indicator names the page being read

#### Scenario: NavigatePages
- **GIVEN** a displayed multi-page PDF
- **WHEN** the user moves to the next page, whether by control or by keyboard
- **THEN** the view moves to that page, it is rendered, and the page indicator reflects it

#### Scenario: LargeDocumentOpensPromptly
- **GIVEN** a PDF of many pages
- **WHEN** it is opened
- **THEN** the scroll spans every page, and only the pages needed for the current view are rendered

#### Scenario: PagesScrolledPastAreReleased
- **GIVEN** a long document scrolled well past its first pages
- **THEN** those pages no longer hold a rendering, and their place in the scroll is unchanged

#### Scenario: TextIsSelectable
- **GIVEN** a displayed page whose PDF has a text layer
- **WHEN** the user selects across the page
- **THEN** the document's own text is selected and can be copied

#### Scenario: TextLayerFailureCostsOnlySelection
- **WHEN** the document's text cannot be placed over a rendered page
- **THEN** the page stays displayed and no failure is reported for it

#### Scenario: ViewerCrashStaysInTheViewer
- **WHEN** the viewer throws while displaying or releasing a document
- **THEN** the surrounding application keeps running and the pane reports that the file could not be displayed

#### Scenario: PdfNeverRendersInServerOrigin
- **WHEN** a workspace PDF is fetched over HTTP
- **THEN** the response is not served as an inline document type — the bytes reach the client as data it renders itself

### Requirement: PdfSizeLimit

The system SHALL apply a PDF-specific size limit, configurable, defaulting to 25 MiB, in place of
the 1 MiB limit that governs other raw file reads. A PDF over that limit SHALL be refused with the
existing too-large error rather than partially loaded, and the viewer SHALL say the file is too
large and what the limit is. The limit for every non-PDF file SHALL be unchanged.

#### Scenario: PdfWithinPdfLimit
- **GIVEN** a 6 MiB PDF in the browser root and a 25 MiB PDF limit
- **WHEN** the user opens it
- **THEN** it is served and displayed, where a 6 MiB non-PDF file would still be refused

#### Scenario: PdfOverPdfLimit
- **GIVEN** a PDF larger than the configured PDF limit
- **WHEN** the user opens it
- **THEN** it is refused as too large, and the viewer reports the limit instead of showing a blank document

#### Scenario: OtherFilesKeepTheirLimit
- **GIVEN** a 2 MiB non-PDF file
- **WHEN** it is requested over the raw-file route
- **THEN** it is still refused as too large

### Requirement: PdfViewerFailureStates

The system SHALL distinguish, in the viewer, a PDF it will not open from one it cannot open. An
encrypted or password-protected PDF, a corrupt one, and one that exceeds the size limit SHALL each
produce a distinct, plain-language message naming the reason. A failure to render one page MUST NOT
blank the whole viewer, and the file MUST remain closable and re-openable.

#### Scenario: EncryptedPdf
- **WHEN** the opened PDF requires a password
- **THEN** the viewer reports that the document is password-protected and offers no partial rendering

#### Scenario: CorruptPdf
- **WHEN** the opened file is not a readable PDF
- **THEN** the viewer reports that the file could not be read as a PDF

#### Scenario: SinglePageFailure
- **GIVEN** a PDF whose page fails to render
- **THEN** that page reports its failure and the rest of the document stays usable

### Requirement: ExtractPdfContentTool

The system SHALL expose a tool that returns the content of a workspace PDF as markdown. The tool
SHALL take the file's path, an optional page range, and a mode selecting text, tables, or both.

Extraction SHALL be performed from the document's own text layer. The tool MUST NOT execute
scripts embedded in the PDF, MUST NOT fetch anything over the network to parse it, and SHALL be
subject to the same path confinement as the other read tools: a path resolving — symlinks
included — outside the sandbox root SHALL be refused.

Output SHALL identify which page each block of content came from, so a later question can name a
page and the agent can request exactly that range.

#### Scenario: ExtractTextFromPdf
- **WHEN** the tool is called on a text-bearing PDF with mode `text`
- **THEN** it returns that PDF's text as markdown, attributed per page

#### Scenario: ExtractPageRange
- **WHEN** the tool is called with a page range
- **THEN** only pages in that range are extracted, and pages outside it are not read

#### Scenario: PathOutsideSandbox
- **WHEN** the tool is called with a path that resolves outside the sandbox root
- **THEN** the call is refused with an access-denied error and no file is read

#### Scenario: NotAPdf
- **WHEN** the tool is called on a file that is not a readable PDF
- **THEN** it returns an error naming that reason, not an empty result

### Requirement: ExtractPdfTables

The system SHALL reconstruct tabular regions of an extracted PDF as GitHub-flavoured markdown
tables, derived from the positions of the text on the page. Content that is not tabular SHALL be
returned as text, and a page containing both SHALL return both in reading order.

Reconstruction is best-effort and the output SHALL be honest about that: when the tool emits a
table it MUST also keep the underlying text recoverable, so a misread grid does not silently lose
content. Merged cells, nested tables, and tables drawn only with ruling lines and no consistent
text alignment are outside what the system claims to reconstruct.

#### Scenario: RegularGridBecomesMarkdownTable
- **GIVEN** a PDF page with a table whose columns are consistently aligned
- **WHEN** the tool is called with mode `tables` or `both`
- **THEN** the table is returned as a markdown table with its rows and columns preserved

#### Scenario: MixedPage
- **GIVEN** a page with a paragraph followed by a table
- **WHEN** the tool is called with mode `both`
- **THEN** both are returned, in the order they appear on the page

#### Scenario: NoTableOnPage
- **WHEN** the tool is called with mode `tables` on a page with no tabular content
- **THEN** it reports that no table was found on that page rather than inventing one

#### Scenario: TableTextRemainsRecoverable
- **WHEN** a reconstructed table misrepresents the page's layout
- **THEN** the page's text content is still obtainable through the tool, so nothing extracted is lost to the reconstruction

### Requirement: BoundedExtractionOutput

The system SHALL bound what one extraction call returns, so a large PDF cannot flood the agent's
context. The tool SHALL cap the number of pages read per call and the size of the returned
markdown. When a cap truncates the result, the output SHALL say so, name the pages actually
covered, and state how to request the rest.

Extraction SHALL also be bounded in time and memory: a document that cannot be parsed within those
bounds SHALL fail with a message saying so, rather than hanging the session.

#### Scenario: LongDocumentTruncated
- **GIVEN** a PDF far larger than the per-call output cap
- **WHEN** the tool is called without a page range
- **THEN** it returns the covered pages, states that the result was truncated, and names the remaining range

#### Scenario: ExplicitRangeBeyondCap
- **WHEN** the tool is called with a page range wider than the per-call page cap
- **THEN** it extracts up to the cap and reports where it stopped

#### Scenario: ParsingExceedsBudget
- **WHEN** a PDF cannot be parsed within the time or memory budget
- **THEN** the call fails with a message naming that reason and the session stays responsive

### Requirement: ReportMissingTextLayer

The system SHALL detect a PDF with no extractable text — a scan, or a page rendered entirely as
images — and SHALL report it explicitly as having no text layer, naming the affected pages. It MUST
NOT return an empty or whitespace-only result as though the document were blank, and it MUST NOT
attempt to guess the content of an image.

The report SHALL name what can see such a page: the page's own image where one can be returned, and
otherwise drawing the page as a picture. Stating only that OCR is unavailable leaves a reader with no
next step, and a caller stops there — so a note about a page nobody can read as text SHALL always
carry the route to looking at it. Returning pixels is not guessing at content, and remains within the
prohibition above: the system still SHALL NOT assert what an image says.

#### Scenario: ScannedDocument
- **WHEN** the tool is called on a PDF whose pages carry no text
- **THEN** it reports that the document has no extractable text layer, that OCR is not provided, and how the pages can be looked at instead

#### Scenario: MixedScanAndText
- **GIVEN** a PDF where some pages have text and others are scans
- **WHEN** the tool is called across both
- **THEN** the text-bearing pages are returned and the image-only pages are named as having no text layer

### Requirement: WholeDocumentExtraction

The extraction tools SHALL offer a way to obtain a whole document in one call, so that receiving all
of it does not depend on a caller choosing to follow a truncation note.

When whole-document extraction is requested, the per-call page, block and output caps SHALL NOT
apply. A single absolute ceiling SHALL still apply, well above the per-call caps, together with the
existing time budget. A document whose extraction exceeds that ceiling SHALL be refused with a
message naming the ceiling and pointing at extraction to a file — never truncated silently, because
silent truncation is the failure this requirement exists to remove.

#### Scenario: WholeDocumentInOneCall
- **GIVEN** a document longer than the per-call cap
- **WHEN** whole-document extraction is requested
- **THEN** every page or block is returned in that one call, and no truncation note is produced

#### Scenario: PastTheAbsoluteCeiling
- **GIVEN** a document whose whole extraction exceeds the absolute ceiling
- **WHEN** whole-document extraction is requested
- **THEN** the call is refused, the message names the ceiling, and it points at extraction to a file

#### Scenario: TimeBudgetStillApplies
- **WHEN** whole-document extraction cannot complete within the time budget
- **THEN** it fails with that reason, as a capped extraction would

### Requirement: ExtractionToFile

The extraction tools SHALL accept a destination path and, when given one, write the **whole**
extraction there and return a summary instead of the content: the path written, how much of the
document it covers, and an opening excerpt. The content itself SHALL NOT be returned in that case —
the point of writing to a file is that the document does not travel through the conversation.

A destination SHALL be governed by the same permission as any other write from this system: refused
when writing is disabled, and refused when the resolved path — symlinks included — falls outside the
writable zone. The extraction tools remain read tools: refusing a destination SHALL NOT prevent the
same call from returning content the usual way.

An existing path SHALL be refused rather than overwritten, naming the path so a caller can choose
another.

The destination is a second path argument, and the confinement that covers the source path does not
cover it. It SHALL be resolved and checked on its own, with the same symlink-safe primitives.

#### Scenario: WriteWholeExtractionToFile
- **GIVEN** a destination inside the writable zone
- **WHEN** extraction is requested with it
- **THEN** the whole extraction is written there, and the call returns the path, the coverage and an excerpt rather than the content

#### Scenario: DestinationOutsideWritableZone
- **WHEN** the destination resolves outside the writable zone, by traversal or through a symlink
- **THEN** it is refused as denied and nothing is written

#### Scenario: WritesDisabled
- **GIVEN** a sandbox where writing is not allowed
- **WHEN** extraction is requested with a destination
- **THEN** it is refused as denied, and no file is created anywhere

#### Scenario: DestinationExists
- **GIVEN** a file already at the destination
- **WHEN** extraction is requested with it
- **THEN** it is refused as a conflict, the existing file is untouched, and the message names the path

#### Scenario: ReadingIsUnaffected
- **WHEN** a destination is refused
- **THEN** the tool's ordinary extraction still works for the same document

### Requirement: StruckThroughTextIsMarked

A PDF has no notion of struck-through text: a producer draws the strike as a thin filled shape over
the glyphs, and the text layer the extractor reads records only the glyphs. Text a document has
crossed out therefore reaches the caller reading as live content, which is the opposite of what the
document says.

The system SHALL read the page's drawing operations alongside its text, and SHALL return text
covered by a strike as a GitHub-flavoured strikethrough span.

Detection SHALL distinguish a strike from the other things drawn with the same primitive. An
underline and a strike differ by where they sit relative to the text's baseline, and the system
SHALL use that: a shape below the baseline is an underline and SHALL NOT mark the text above it. A
shape that spans text it does not overlap horizontally, that is too tall to be a rule, or that is
drawn as an outline rather than filled — a table border, a page rule, a box around a callout — SHALL
NOT mark anything.

Like table reconstruction, this is derived from where ink landed and the output SHALL be honest
about it. Marking SHALL only ever add markers around text the system already returned: no text is
dropped, altered or reordered by strike detection, so a missed or spurious strike costs a marker,
never content. Struck text SHALL be marked in every mode that returns that text, including inside a
reconstructed table.

Reading the drawing operations SHALL stay inside the extraction's existing time budget and output
caps, and a page whose drawing operations cannot be read SHALL still return its text, unmarked,
rather than failing the extraction.

Markers alone are not enough to be noticed. When a document crosses anything out, the extraction
SHALL say so *before* the content, naming how many passages are struck and what the markers mean, so
a reader that works top to bottom cannot answer from the text without having read the warning. A
document that crosses nothing out SHALL carry no such line.

#### Scenario: StruckTextIsAnnouncedBeforeTheContent
- **GIVEN** a PDF whose pages draw strikes across some of their text
- **WHEN** it is extracted
- **THEN** the result opens with a line saying how many passages are struck out and what the markers mean, before the first page's content

#### Scenario: NothingStruckAnnouncesNothing
- **GIVEN** a PDF that draws no strike over any text
- **WHEN** it is extracted
- **THEN** the result carries no such line

#### Scenario: WordStrikethroughIsMarked
- **GIVEN** a PDF produced by a word processor in which a sentence is struck through
- **WHEN** the page is extracted
- **THEN** that sentence is returned wrapped in `~~`, and the rest of the page is unmarked

#### Scenario: UnderlineIsNotAStrike
- **GIVEN** a page whose only decorated text is an underlined hyperlink
- **WHEN** the page is extracted
- **THEN** no text is returned as struck through

#### Scenario: PageRulesAndBordersAreNotStrikes
- **GIVEN** a page carrying horizontal rules, and a table drawn with ruling lines
- **WHEN** the page is extracted
- **THEN** no text is returned as struck through

#### Scenario: PartiallyStruckLine
- **GIVEN** a line of text of which only some words are struck through
- **WHEN** the page is extracted
- **THEN** the markers cover the struck words and not the whole line

#### Scenario: StruckTextInsideAReconstructedTable
- **GIVEN** a table cell whose text is struck through
- **WHEN** the page is extracted with mode `tables` or `both`
- **THEN** the cell shows the struck span, and every row still has the column count the reconstruction found

#### Scenario: NothingIsLostToDetection
- **GIVEN** a page whose strikes are detected wrongly or not at all
- **WHEN** the page is extracted
- **THEN** the page's text is returned in full, exactly as it would be without strike detection

#### Scenario: UnreadableDrawingOperations
- **GIVEN** a page whose drawing operations cannot be read
- **WHEN** the page is extracted
- **THEN** the page's text is returned unmarked rather than the extraction failing

#### Scenario: DetectionStaysWithinTheBudget
- **GIVEN** a document large enough that reading its drawing operations would exceed the time budget
- **WHEN** it is extracted
- **THEN** the extraction reports the budget the same way it does today, rather than running past it

### Requirement: PageImagesAreMarkedAndReturnable

Extraction SHALL mark each image a page draws, at its place in that page's content, naming its pixel
dimensions and carrying a stable identifier the same call's image parameter accepts. A scanned page is
one such image, and marking it is what turns a dead end into something a caller can act on.

Image bytes SHALL travel only when the call asks for them, under a bound on their number and total
bytes, with the answer naming what was left and how to ask for it.

Where an image can be returned, it SHALL be returned at the resolution the file holds rather than
rescaled to a page width — a scan is typically held well above the width a page drawing would use,
and that detail is the whole value of looking at it. An image whose encoding cannot be turned into a
viewable picture SHALL still be marked, with the reason.

#### Scenario: ScannedPageIsItsOwnImage
- **GIVEN** a PDF page with no text layer whose content is a single scanned image
- **WHEN** the page is extracted, asking for its images
- **THEN** that image is returned at the resolution the file holds, and its marker names its dimensions

#### Scenario: NoImageBytesByDefault
- **WHEN** a PDF holding images is extracted without asking for them
- **THEN** the result holds the markers and no image content

#### Scenario: ImageBudgetIsStated
- **GIVEN** a PDF holding more image bytes than one call returns
- **WHEN** its images are asked for
- **THEN** the images within the bound are returned, and the answer says how many were left and how to ask for them

#### Scenario: UndecodableImageIsStillNamed
- **GIVEN** a page drawing an image whose encoding cannot be turned into a viewable picture
- **WHEN** the page is extracted, asking for its images
- **THEN** a marker states the image is present and why its bytes are not available, and the extraction otherwise succeeds

### Requirement: DrawPdfPagesAsPictures

The system SHALL expose a tool that draws a PDF's pages as pictures and returns them with the page
count, taking the file's path and an optional page range, and returning at most a stated number of
pages per call.

It exists for what image extraction cannot reach: a page carrying no text layer and no extractable
image — a vector-drawn export, a map, a plot — and for a caller that needs to see how a page actually
looks rather than what it contains. Where a page's own image can be returned instead, that is the
better answer, and the tool SHALL NOT be presented as the first route to a scan.

Drawing a page SHALL NOT require an office application: a PDF needs no conversion before it can be
drawn. Where pages cannot be drawn at all, the tool SHALL say so and name what is missing rather than
returning an empty result.

#### Scenario: VectorPageWithNoTextIsDrawn
- **GIVEN** a PDF page with no text layer whose content is drawn as vectors rather than placed as an image
- **WHEN** the page is drawn
- **THEN** a picture of the page is returned

#### Scenario: PageRangeAndCount
- **GIVEN** a PDF of several pages
- **WHEN** a range naming two of them is drawn
- **THEN** pictures of those two pages are returned, together with the document's page count

#### Scenario: PageCapIsStated
- **GIVEN** a PDF with more pages than one call returns
- **WHEN** it is drawn without a range
- **THEN** the pictures within the cap are returned and the answer says which pages were not drawn

#### Scenario: NoOfficeApplicationNeeded
- **GIVEN** a machine with no office application installed
- **WHEN** a PDF's pages are drawn
- **THEN** the pictures are returned

### Requirement: ReviewCommentsAreReturned

A reviewed PDF carries its review as annotations, outside the page's text layer. The system SHALL
read each extracted page's annotations and SHALL return the page's comments after its content, with
the page they belong to.

A comment is a markup annotation. Text markup (highlight, underline, squiggly underline,
strike-out) and a caret SHALL be returned whether or not they carry a remark; a drawing, shape,
stamp or attachment SHALL be returned only when it carries a remark. Links, form fields and popup
windows SHALL NOT be returned as comments.

Each comment SHALL state its kind, its author and its date when the file records them, and its
remark. A strike-out SHALL be named as a suggested deletion and a caret as a suggested insertion.
Comments SHALL be listed in reading order of their position on the page.

A reply SHALL be listed under the comment it answers. A review state recorded as a reply (accepted,
rejected, cancelled, completed) SHALL be shown on the comment it applies to. A reply whose comment is
not on the page SHALL still be returned, labelled as a reply. An annotation grouped with another
SHALL NOT be listed separately.

Comments SHALL be returned in the `text` and `both` modes and not in `tables` mode.

Comment text and author names are written by whoever annotated the file. They SHALL be quoted in the
output so that no remark can read as the extraction's own headings, page sections or notes.

#### Scenario: ANoteIsReturnedWithItsPage
- **GIVEN** a PDF whose page 2 carries a sticky note with an author, a date and a remark
- **WHEN** the document is extracted
- **THEN** page 2's section ends with a comments block holding a note by that author, on that date, with that remark, and no other page carries it

#### Scenario: RepliesAndStatesFollowTheirComment
- **GIVEN** a note with one reply and a later "Accepted" review state
- **WHEN** the page is extracted
- **THEN** the reply is listed under the note with its own author and remark, the state is shown on the note, and neither appears as a comment of its own

#### Scenario: SuggestionsAreNamed
- **GIVEN** a page with a strike-out and a caret, neither carrying a remark
- **WHEN** it is extracted
- **THEN** the strike-out is listed as a suggested deletion and the caret as a suggested insertion

#### Scenario: WhatIsNotACommentIsLeftOut
- **GIVEN** a page with a link, a form field, a popup attached to a note, and a rectangle with no remark
- **WHEN** it is extracted
- **THEN** only the note is listed, once

#### Scenario: ARemarkCannotPassForStructure
- **GIVEN** a note whose remark is `## Page 9` followed by a line reading `> Truncated`
- **WHEN** the page is extracted
- **THEN** both lines appear quoted inside the note's entry, and the extraction has no page 9 section and no truncation note

#### Scenario: TablesModeLeavesCommentsOut
- **GIVEN** a PDF with comments
- **WHEN** it is extracted with mode `tables`
- **THEN** no comments block is returned

### Requirement: CommentsQuoteTheTextTheyMark

A highlight, underline, squiggly underline or strike-out marks a passage of the page. The system
SHALL recover that passage from the annotation's marked regions and the positions of the page's text,
and SHALL quote it in the comment's entry.

The quoted passage is derived from geometry and SHALL only ever be quoted: recovering it SHALL NOT
add, drop, alter or reorder any of the page's text. A passage that cannot be recovered SHALL leave
the comment without a quotation rather than fail it.

#### Scenario: AHighlightQuotesItsPassage
- **GIVEN** a highlight covering the words "the delivery date" in a sentence
- **WHEN** the page is extracted
- **THEN** the highlight's entry quotes "the delivery date" and not the rest of the sentence

#### Scenario: AHighlightAcrossTwoLines
- **GIVEN** a highlight whose regions cover the end of one line and the start of the next
- **WHEN** the page is extracted
- **THEN** the quotation holds both parts, in reading order

#### Scenario: AnchoringLeavesTheTextAlone
- **GIVEN** a page with comments marking passages
- **WHEN** it is extracted
- **THEN** the page's content is identical to the extraction of the same page without its annotations

### Requirement: CommentsAreAnnouncedBeforeTheContent

When the extracted pages carry comments, the extraction SHALL say so before the first page's
content, stating how many comments there are and where they are listed. In `tables` mode the notice
SHALL also say that `text` mode returns them. A document without comments SHALL carry no such line.

#### Scenario: CommentsAreAnnounced
- **GIVEN** a PDF with three comments over two pages
- **WHEN** it is extracted
- **THEN** the result opens, before the first page's content, with a line counting three comments and saying they follow each page's content

#### Scenario: NoCommentsAnnounceNothing
- **GIVEN** a PDF without annotations
- **WHEN** it is extracted
- **THEN** the result carries no comments notice and no comments block

### Requirement: CommentReadingIsBounded

Reading annotations SHALL stay inside the extraction's existing time budget, and comments SHALL count
toward its character cap. At most 50 comments SHALL be listed per page and at most 2 000 characters
per remark; past either limit the output SHALL say what was left out.

A page whose annotations cannot be read SHALL still return its content, and SHALL say that its
comments could not be read. The extraction SHALL NOT fail for it.

#### Scenario: ManyCommentsAreCapped
- **GIVEN** a page with 60 notes
- **WHEN** it is extracted
- **THEN** 50 are listed and the block says 10 more were left out

#### Scenario: UnreadableAnnotationsDoNotFailThePage
- **GIVEN** a page whose annotations cannot be read
- **WHEN** it is extracted
- **THEN** its text is returned, it says its comments could not be read, and the other pages are extracted as usual
