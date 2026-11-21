# Spec Delta

## MODIFIED Requirements

### Requirement: BoundedExtractionOutput

The system SHALL bound what one extraction call returns, so a large PDF cannot flood the agent's
context. The tool SHALL cap the number of pages read per call and the size of the returned
markdown. When a cap truncates the result, the output SHALL say so, name the pages actually
covered, and state how to request the rest.

Extraction SHALL also be bounded in time and memory: a document that cannot be parsed within those
bounds SHALL fail with a message saying so, rather than hanging the session. The time budget SHALL
follow the number of pages the call reads — a base plus a share per page, under a ceiling — so a
range of slow pages is not held to what a short call may spend. When the budget runs out after some
pages were read, and the call did not ask for the whole document, the call SHALL return those pages
as a truncated result naming the page to start again from. Otherwise the failure SHALL name the step
that ran out, the pages read before it, and a range to ask for instead.

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

#### Scenario: ABudgetSpentMidRangeReturnsThePagesRead
- **GIVEN** a range whose first page reads quickly and whose next pages are slow scans
- **WHEN** the budget runs out on the second page
- **THEN** the first page is returned, with a note that the budget ran out at page 2 and the range to call again with

#### Scenario: AWholeDocumentOutOfTimeSaysWhereAndWhatToAsk
- **GIVEN** the same document extracted whole
- **WHEN** the budget runs out on the second page
- **THEN** the call fails naming the step that ran out on page 2, the pages read before it, and a range to ask for

### Requirement: PageImagesAreMarkedAndReturnable

Extraction SHALL mark each image a page draws, at its place in that page's content, naming its pixel
dimensions and carrying a stable identifier the same call's image parameter accepts. A scanned page is
one such image, and marking it is what turns a dead end into something a caller can act on.

Image bytes SHALL travel only when the call asks for them, under a bound on their number and total
bytes, with the answer naming what was left and how to ask for it. The bound on their number SHALL NOT
exceed the number of images the active model declares it accepts. An image the call does not return
SHALL be named without being encoded.

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

#### Scenario: PicturesNotAskedForAreNamedNotEncoded
- **GIVEN** pages each drawing a large scan
- **WHEN** they are extracted asking for none of their images, or for one by number
- **THEN** every image is marked with its format and dimensions, and only the one asked for carries bytes

### Requirement: DrawPdfPagesAsPictures

The system SHALL expose a tool that draws a PDF's pages as pictures and returns them with the page
count, taking the file's path and an optional page range, and returning at most a stated number of
pages per call — fewer when the active model declares it accepts fewer images.

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

## ADDED Requirements

### Requirement: RequestsStayWithinTheModelImageLimit

When the active model declares how many images it accepts — `inputLimits.images.maxPerRequest` or
`maxPerMessage` — no tool returning pictures SHALL return more than that in one result, and each
request to the model SHALL carry no more images than the model accepts, keeping the newest. An image
left out of a request SHALL be replaced in that request by a line saying so; the stored conversation
SHALL keep it. A model that declares no limit SHALL see every image, as before.

#### Scenario: AToolNeverReturnsMoreImagesThanTheModelTakes
- **GIVEN** a model declaring it accepts at most 4 images per request, behind a gateway that refuses more
- **WHEN** the agent draws a ten-page PDF without a range
- **THEN** the result carries 4 pages, says the model's limit is why, and names the range of the rest

#### Scenario: ARequestKeepsItsNewestImagesWithinTheLimit
- **GIVEN** that conversation, which already holds 4 images
- **WHEN** the agent draws 4 more pages
- **THEN** the request carries the 4 new pages, the older ones' places say they were left out, and the gateway refuses nothing
