# pptx-documents Specification

## Purpose

Lets the agent read the text and declared tables of a workspace PowerPoint presentation without a
shell or external converter, while retaining slide order and safe resource bounds.
## Requirements
### Requirement: ExtractPptxContentTool

The system SHALL expose a tool that returns a workspace `.pptx` presentation as markdown. The tool
SHALL accept a path and an optional slide range. It SHALL return slides in their declared
presentation order, label each slide with its slide number, and use a slide's title when one is
declared so a later call can request a precise range.

Extraction SHALL read presentation markup locally. It MUST NOT fetch external resources, resolve
linked media, or execute embedded content. A path resolving — symlinks included — outside the
sandbox read zone SHALL be refused before the file is opened.

#### Scenario: ExtractPresentationInSlideOrder
- **WHEN** the tool is called on a readable presentation without a range
- **THEN** it returns the extractable content of its slides in the order the presentation declares,
  with each slide numbered

#### Scenario: ExtractSelectedSlides
- **WHEN** the tool is called with a slide range
- **THEN** it returns only the selected slides and does not read unselected slides into the result

#### Scenario: PathOutsideSandbox
- **WHEN** the tool targets a path that resolves outside the sandbox read zone
- **THEN** it reports access denied and reads no file

#### Scenario: NotAPresentation
- **WHEN** the tool is called on a non-PowerPoint or malformed PowerPoint file
- **THEN** it reports that the file is not a readable presentation rather than returning an empty result

#### Scenario: EncryptedPresentation
- **WHEN** the presentation is password-protected
- **THEN** the tool reports that reason rather than returning encrypted parts as text

### Requirement: SlideTextAndTablesPreserveDeclaredStructure

The system SHALL extract text-bearing shapes and declared tables from each slide. It SHALL preserve
their order in the slide's markup and render a declared table as a GitHub-flavoured markdown table.
Table-cell text MUST NOT be able to alter the table structure it occupies.

The system SHALL state when a readable presentation has no extractable slide text or tables. It
SHALL name unsupported visual-only content — including images, charts, diagrams, animations,
speaker notes, comments, and embedded media — rather than implying the extraction describes it.

#### Scenario: TextAndTableOnOneSlide
- **GIVEN** a slide containing text shapes and a declared table
- **WHEN** it is extracted
- **THEN** the text and table appear in their declared order, and the table has the rows and cells
  the presentation declares

#### Scenario: CellCannotBreakTheTable
- **GIVEN** a table cell containing a pipe or a backslash
- **WHEN** the table is returned as markdown
- **THEN** every returned row keeps the number of columns the table declares

#### Scenario: VisualOnlySlide
- **GIVEN** a readable slide whose content is only an image or chart
- **WHEN** it is extracted
- **THEN** the output reports that the slide has no extractable text and names the unread visual content

### Requirement: BoundedPptxExtraction

The system SHALL bound a normal extraction by both the number of slides and the markdown returned.
When either cap truncates the result, it SHALL state that truncation, name the slide range covered,
and explain how to request the remainder.

Before parsing, a file above the configured presentation size ceiling SHALL be refused. While
reading the Office archive, the total decompressed bytes, the entry count, and the parsing time
SHALL each be capped. Exceeding any cap SHALL fail with a reason rather than exhausting the process.

The tool SHALL support whole-presentation extraction and optional writing of that whole extraction
to a new path in the writable zone. An existing destination, a destination outside that zone, or
writes disabled SHALL be refused without writing anything.

#### Scenario: LongPresentationTruncated
- **GIVEN** a presentation beyond the normal per-call slide or output cap
- **WHEN** it is extracted without a slide range
- **THEN** it returns the covered slides, reports truncation, and names the remaining range

#### Scenario: OversizePresentationRefused
- **WHEN** a presentation exceeds the configured size ceiling
- **THEN** the tool refuses it before parsing and reports the limit

#### Scenario: CompressionBombRefused
- **GIVEN** a presentation archive whose entries expand beyond the decompression cap
- **WHEN** it is read
- **THEN** extraction stops and reports the exceeded decompression limit

#### Scenario: WholePresentationToFile
- **GIVEN** a new destination inside the writable zone
- **WHEN** whole-presentation extraction is requested with that destination
- **THEN** the complete extraction is written there and the tool returns its path, coverage, and an excerpt

#### Scenario: PresentationDestinationRefused
- **WHEN** the extraction destination already exists, is outside the writable zone, or writes are disabled
- **THEN** the tool refuses the request and writes nothing

### Requirement: SlidePicturesAreMarkedAndReturnable

Slide extraction SHALL mark each picture at its place in the slide's content, naming the picture's
format and pixel dimensions and carrying its alternative text when the slide declares one, with a
stable identifier the same call's picture parameter accepts.

This matters more on a slide than in a document: a deck's argument often lives in its pictures, and a
slide whose content is only a picture currently reads as a slide with nothing on it.

Picture bytes SHALL travel only when the call asks for them, under a bound on their number and total
bytes, and the answer SHALL say what was left and how to ask for it. A vector picture SHALL be
rasterised where the system can, and its marker SHALL say so where it cannot.

A picture whose bytes cannot be returned SHALL still be marked, with the reason. Content that is not
a picture at all — a native chart, a diagram, a grouped drawing, a shape — SHALL continue to be named
as unsupported visual content rather than marked as a picture: there is no picture in the file to
return, and reporting one would claim bytes exist that do not.

#### Scenario: SlidePictureIsMarked
- **GIVEN** a slide holding a title and a picture
- **WHEN** the deck is extracted
- **THEN** the slide's markdown holds the title and a marker for the picture naming its format and dimensions

#### Scenario: SlideWhoseOnlyContentIsAPicture
- **GIVEN** a slide holding nothing but a picture
- **WHEN** the deck is extracted
- **THEN** the slide is reported as holding that picture, not as holding nothing readable

#### Scenario: SlidePictureBytesOnRequest
- **GIVEN** a deck holding pictures on two slides
- **WHEN** the extraction is asked for its pictures
- **THEN** both are returned as image content, each matching the identifier on its marker

#### Scenario: NoSlidePictureBytesByDefault
- **WHEN** a deck holding pictures is extracted without asking for them
- **THEN** the result holds the markers and no image content

#### Scenario: AChartIsNotAPicture
- **GIVEN** a slide holding a native chart and no picture
- **WHEN** the deck is extracted, asking for its pictures
- **THEN** the chart is named as unsupported visual content, no picture marker is written for it, and no image content is returned for it
