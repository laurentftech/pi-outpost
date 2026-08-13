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

#### Scenario: ScannedDocument
- **WHEN** the tool is called on a PDF whose pages carry no text
- **THEN** it reports that the document has no extractable text layer and that reading it would require OCR, which is not provided

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

