# docx-export Specification

## Purpose
Lets a reader take a document displayed in the viewer away as a Word file that keeps its structure —
its headings, lists, tables, equations and diagrams — so a document written here can be sent to
someone who does not open a repository without being rebuilt by hand.

## Requirements

### Requirement: ExportDisplayedDocumentAsWord

The system SHALL offer, for a text file successfully displayed in the viewer, an action that
produces that document as an Office Open XML word-processing package and hands it to the browser as
a download.

The downloaded file SHALL be named after the source with the `.docx` extension replacing the
source's own extension — `README.md` becomes `README.docx`, `notes.txt` becomes `notes.docx`, and a
name with no extension gains one. Nothing SHALL be written into the workspace: the export is a
download, and the workspace is unchanged by it.

The action SHALL NOT be offered where it has no meaning: a file that has not loaded, an image, a
PDF, or the viewer showing uncommitted changes rather than the document.

Conversion SHALL happen without contacting the network. The document's own text is the only input.

#### Scenario: DownloadMarkdownAsWord
- **WHEN** the export action is invoked on a displayed Markdown file
- **THEN** the browser is handed a `.docx` file named after the source, and no workspace file is created

#### Scenario: ExportNamesTheFileAfterItsSource
- **GIVEN** a displayed file named `report.md`
- **WHEN** it is exported
- **THEN** the downloaded file is named `report.docx`

#### Scenario: NotOfferedForUnexportableViews
- **WHEN** the viewer is showing an image, a PDF, a file that failed to load, or an uncommitted diff
- **THEN** no export action is offered

#### Scenario: ExportIsOffline
- **WHEN** a document is exported
- **THEN** no network request is made to produce it

### Requirement: ExportCarriesWhatTheReaderIsLookingAt

The exported document SHALL be produced from the text the viewer is currently rendering, not from
the last text written to disk. When an edit buffer is open, its unsaved draft is what the reader
sees rendered and therefore what the export SHALL carry.

Exporting SHALL NOT alter the document being viewed: it MUST NOT save, modify the edit buffer, close
the viewer, or change the view mode.

#### Scenario: UnsavedDraftIsExported
- **GIVEN** an open edit buffer whose draft differs from the file on disk
- **WHEN** the document is exported
- **THEN** the exported document carries the draft, not the saved content

#### Scenario: ExportLeavesTheViewerAlone
- **WHEN** a document is exported
- **THEN** the edit buffer, its dirty state, and the current view mode are unchanged, and nothing is saved

### Requirement: MarkdownStructureBecomesWordStructure

Where the source is Markdown, the system SHALL map its structure onto the corresponding Word
structure rather than reproducing its source characters as text.

Headings SHALL become paragraphs carrying Word's heading styles at the level the document declares.
Bulleted and ordered lists SHALL become Word lists, preserving nesting and ordinal type. Tables
SHALL become Word tables with the rows and cells the document declares, with the header row marked
as such. Emphasis, strong emphasis, strikethrough, inline code and links SHALL become runs and
hyperlinks carrying those properties. A fenced or indented code block SHALL become a monospaced
block that preserves its line breaks and leading whitespace, and its content MUST NOT be interpreted
as Markdown. Block quotes and thematic breaks SHALL be represented as such.

A construct the mapping does not cover SHALL be carried as readable text rather than dropped, and
MUST NOT be emitted as raw Markdown punctuation where a mapping exists.

#### Scenario: HeadingsBecomeWordHeadings
- **GIVEN** a document with headings at several levels
- **WHEN** it is exported
- **THEN** each becomes a paragraph with the Word heading style of the corresponding level, and no `#` characters remain in its text

#### Scenario: NestedListsArePreserved
- **GIVEN** a bulleted list containing a nested ordered list
- **WHEN** it is exported
- **THEN** both are Word lists at their respective levels, with the ordered one numbered

#### Scenario: TableBecomesWordTable
- **GIVEN** a GitHub-flavoured Markdown table
- **WHEN** it is exported
- **THEN** it becomes a Word table with the declared rows and cells, its first row marked as the header

#### Scenario: InlineFormattingSurvives
- **GIVEN** text carrying strong emphasis, emphasis, strikethrough, inline code and a link
- **WHEN** it is exported
- **THEN** each is a run with the corresponding property, and the link is a working hyperlink

#### Scenario: CodeBlockIsNotInterpreted
- **GIVEN** a fenced code block whose content contains Markdown syntax and leading indentation
- **WHEN** it is exported
- **THEN** it becomes a monospaced block reproducing that content verbatim, with its line breaks and indentation intact

### Requirement: EquationsBecomeNativeWordEquations

The system SHALL carry LaTeX equations into the export as native Word equations, so that they are
selectable, editable in Word, typeset by Word's own engine, and — for an inline equation — placed on
the text baseline the way surrounding text is.

Both inline and display equations SHALL be carried, and the distinction between them SHALL be
preserved: an inline equation stays within its paragraph, a display equation becomes its own block.

An operator that takes an operand — a sum, an integral — SHALL be given the operand it applies to,
and SHALL NOT be written with that place left empty. Word draws nothing for an empty operand, so
such a defect is invisible there and appears as a placeholder box in every other reader.

An equation the transform cannot represent SHALL fall back to its LaTeX source as readable text, and
MUST NOT produce a malformed equation, an empty space, or a package Word refuses to open. A single
untranslatable equation MUST NOT fail the export.

#### Scenario: InlineEquationIsNative
- **GIVEN** a paragraph containing an inline equation
- **WHEN** the document is exported
- **THEN** the equation is a native Word equation within that paragraph, and the paragraph's surrounding text is unbroken

#### Scenario: DisplayEquationIsItsOwnBlock
- **GIVEN** a display equation
- **WHEN** the document is exported
- **THEN** it becomes a native Word equation in its own block, not inline within neighbouring text

#### Scenario: EquationIsEditableInWord
- **GIVEN** an exported document containing an equation
- **WHEN** it is opened in Word
- **THEN** the equation is an equation object rather than an image or literal text

#### Scenario: NAryOperatorCarriesItsOperand
- **GIVEN** an equation containing a sum or an integral
- **WHEN** it is exported
- **THEN** the operator's operand is inside it, and no place within the operator is left empty

#### Scenario: UntranslatableEquationFallsBackToSource
- **GIVEN** an equation the transform cannot represent
- **WHEN** the document is exported
- **THEN** its LaTeX source appears as readable text, the rest of the document is unaffected, and the package still opens

### Requirement: DiagramsAreEmbeddedAsVectorWithRasterFallback

The system SHALL embed a rendered diagram in the export as a vector image, using the Office
extension that carries SVG, and SHALL also include a raster image of the same diagram as the
fallback the image refers to.

Word SHALL therefore draw the vector, at any zoom, while a reader whose application does not
recognise the extension SHALL see the raster rather than a broken or missing image.

The embedded vector SHALL carry its own appearance: the properties that decide how each shape is
painted SHALL be attributes of that shape, and the image MUST NOT depend on a stylesheet inside it.
A reader that draws SVG without applying CSS is not a hypothetical — it is the common case outside
a browser, and such a reader given a stylesheet-dependent drawing paints every shape in the default
fill, which is a solid black block rather than a diagram. The raster does not save it, because a
reader that follows the vector never asks for the fallback.

Each embedded image SHALL declare a physical size derived from the diagram's own dimensions, so that
it appears at a sensible size on the page rather than at an arbitrary one, and SHALL be constrained
to the page's text width when it would otherwise exceed it.

A diagram that cannot be rendered or rasterised SHALL fall back to its source text in a monospaced
block, and MUST NOT fail the export or produce an image part the package refers to but does not
contain.

#### Scenario: DiagramIsVectorInWord
- **GIVEN** a document containing a rendered diagram
- **WHEN** the export is opened in Word
- **THEN** the diagram is drawn from the vector image and stays sharp when enlarged

#### Scenario: VectorNeedsNoStylesheet
- **GIVEN** a document containing a rendered diagram
- **WHEN** the embedded vector image is examined
- **THEN** each shape carries the properties that paint it, and the image contains no stylesheet

#### Scenario: VectorKeepsTheLayoutItWasDrawnWith
- **GIVEN** a diagram whose shapes were laid out at particular sizes
- **WHEN** the image is given the explicit dimensions it needs to be drawn
- **THEN** only the image's own size is set, and the sizes of the shapes within it are unchanged

#### Scenario: FallbackImageIsPresent
- **WHEN** a document containing a diagram is exported
- **THEN** the package contains both the vector and a raster image of that diagram, and the picture refers to the raster as its fallback

#### Scenario: OtherReadersSeeThePicture
- **GIVEN** an exported document opened in an application that does not support the SVG extension
- **THEN** the raster image is displayed rather than a broken or missing image

#### Scenario: DiagramIsSizedForThePage
- **GIVEN** a diagram wider than the page's text width
- **WHEN** the document is exported
- **THEN** the image is constrained to the text width and keeps its aspect ratio

#### Scenario: UnrenderableDiagramFallsBackToSource
- **GIVEN** a diagram that cannot be rendered or rasterised
- **WHEN** the document is exported
- **THEN** its source appears as a monospaced block, the export still succeeds, and the package refers to no missing part

### Requirement: PlainTextExportsAsReadableDocument

Where the source is not Markdown, the system SHALL export it as a Word document of monospaced
paragraphs that preserves the file's lines and their leading whitespace, and SHALL NOT interpret its
content as Markdown, as equations, or as diagrams.

#### Scenario: TextFileKeepsItsLines
- **GIVEN** a displayed `.log` or `.txt` file
- **WHEN** it is exported
- **THEN** each line is a monospaced paragraph preserving its indentation

#### Scenario: TextIsNotInterpreted
- **GIVEN** a non-Markdown text file whose content contains `#`, pipes and dollar signs
- **WHEN** it is exported
- **THEN** those characters appear literally, with no heading, table or equation produced from them

### Requirement: TheExportIsAValidWordPackage

The system SHALL produce a package that Word opens without reporting it as damaged and without
offering to repair it, and that other Office Open XML readers open as a word-processing document.

Every relationship the document declares SHALL resolve to a part the package contains, every part
SHALL be declared with its content type, and text taken from the source document MUST NOT be able to
alter the structure of the package: characters that are markup in XML SHALL be escaped, and content
from the document MUST NOT be able to close an element, inject an attribute, or introduce a part.

#### Scenario: WordOpensItWithoutRepair
- **WHEN** an exported document is opened in Word
- **THEN** it opens as a document, with no repair prompt and no damage report

#### Scenario: EveryRelationshipResolves
- **WHEN** a document containing images, hyperlinks and equations is exported
- **THEN** every declared relationship refers to a part present in the package, and every part has a declared content type

#### Scenario: DocumentTextCannotBreakThePackage
- **GIVEN** a document whose text contains angle brackets, ampersands, quotation marks and XML-like markup
- **WHEN** it is exported
- **THEN** that text appears literally in the document and the package structure is unaffected

### Requirement: ExportIsBoundedAndReportsFailure

The system SHALL bound the work an export performs so that a large document cannot make the
application unresponsive, and SHALL keep the interface responsive while an export is in progress,
showing that it is running.

An export that cannot be produced SHALL report that to the reader with the reason, and MUST NOT fail
silently, hand over a truncated or empty file, or leave the interface appearing to work. A failure
to produce one figure is not a failure of the export: it falls back as its own requirement describes.

#### Scenario: ExportInProgressIsVisible
- **WHEN** an export is running
- **THEN** the interface shows that it is in progress and remains responsive

#### Scenario: FailedExportSaysSo
- **WHEN** an export cannot be produced
- **THEN** the reader is told, with the reason, and no file is downloaded

#### Scenario: LargeDocumentDoesNotHangTheApplication
- **GIVEN** a document far larger than a typical note
- **WHEN** it is exported
- **THEN** the application stays responsive and either completes the export or reports why it stopped
