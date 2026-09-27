## MODIFIED Requirements

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

## ADDED Requirements

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
