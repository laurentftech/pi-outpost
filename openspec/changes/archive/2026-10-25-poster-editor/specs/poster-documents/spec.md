## Purpose

What a poster is in every host — one printable page the model writes in HTML and CSS, in a known paper format — and how it leaves as a Word document to print or a PowerPoint slide to show.

## ADDED Requirements

### Requirement: PosterIsOnePrintablePage

A poster SHALL be stored as one HTML page, `<title>.poster.html`, holding its markup and its stylesheet apart and its paper format, sized to that format and printable with no margin from a browser. The same file SHALL be read back into the markup, stylesheet and format it was written from.

#### Scenario: APosterOpensAndPrintsInABrowser
- **GIVEN** a poster in the A4 portrait format
- **WHEN** its file is opened in a browser and printed
- **THEN** it fills one A4 portrait page, with its colours and backgrounds

#### Scenario: APosterFileIsReadBack
- **WHEN** a poster file written for a markup, a stylesheet and a format is read
- **THEN** the same markup, stylesheet and format are returned

### Requirement: PosterFormats

A poster SHALL be in one of these formats, each with a fixed page size in CSS pixels: A4 portrait 794 × 1123, A4 landscape 1123 × 794, A3 portrait 1123 × 1587, A3 landscape 1587 × 1123, and a 16:9 slide 1280 × 720. Any other format SHALL be refused with the list of formats.

#### Scenario: AnUnknownFormatIsRefused
- **WHEN** a poster is created with a format not in the list
- **THEN** nothing is written, and the refusal names the formats that exist

### Requirement: PosterHoldsNoScriptAndFetchesNothing

A poster SHALL be refused when its markup holds a script, and SHALL be shown, edited and exported without any request leaving for a resource it names. Pictograms are emoji or inline SVG without text.

#### Scenario: AScriptIsRefused
- **WHEN** a poster's markup contains a `<script>` element
- **THEN** it is refused, and nothing is written

#### Scenario: ARemoteImageIsNotFetched
- **GIVEN** a poster whose markup names an image on another server
- **WHEN** it is shown, edited or exported
- **THEN** no request is made for that image

### Requirement: PosterSizeIsBounded

A poster's markup and stylesheet together SHALL be refused above a fixed ceiling, with a message telling the model to use emoji or small inline SVG rather than embedded pictures.

#### Scenario: AnOversizedPosterIsRefused
- **WHEN** a poster's markup and stylesheet exceed the ceiling
- **THEN** it is refused with that advice, and nothing is written

### Requirement: ThePosterGuide

Every host SHALL give the model the same guide for writing a poster: the page sizes, laying out to fill the page, styling through classes, keeping every text as real text in ordinary elements so it can be corrected, emoji or inline SVG for pictograms, system fonts only, nothing fetched, no script.

#### Scenario: EveryHostGivesTheSameGuide
- **WHEN** the guide is read from the Claude extension, the pi-outpost skill and the Open WebUI tool descriptions
- **THEN** each holds the same rules, from one source

### Requirement: ExportToWord

A poster SHALL export to a Word document of one page: an A4 or A3 page as its format says, portrait or landscape, a 16:9 slide on A4 landscape, with Word's narrow margins (1.27 cm) on every side and the poster as large as fits inside them, centred, its proportions kept.

#### Scenario: AnA4PosterPrintsOnOneA4Page
- **WHEN** an A4 portrait poster is exported to Word and opened in desktop Word
- **THEN** the document has one A4 portrait page with 1.27 cm margins, and the poster sits centred inside them

#### Scenario: ASlideGoesOnALandscapePage
- **WHEN** a 16:9 poster is exported to Word
- **THEN** its page is A4 landscape, the poster centred within the margins

### Requirement: ExportToPowerPoint

A poster SHALL export to a PowerPoint deck of one standard widescreen slide (33.867 × 19.05 cm) whatever its format, the poster as large as fits, centred, its proportions kept.

#### Scenario: APortraitPosterOnAWidescreenSlide
- **WHEN** an A4 portrait poster is exported to PowerPoint and opened in desktop PowerPoint
- **THEN** the deck has one 16:9 slide, and the poster fills its height, centred

### Requirement: ExportedPictureFidelity

An export SHALL carry the poster as a picture of the page as the editor shows it, unsaved touch-ups included, at about 300 dots per inch on A4 and no more than 4000 pixels on its longer side, with emoji, borders, rounded corners and inline SVG drawn.

#### Scenario: TheExportMatchesTheEditor
- **GIVEN** a poster retouched in the editor and not yet saved
- **WHEN** it is exported
- **THEN** the picture shows the retouched page, its emoji and drawings included

### Requirement: ExportsNeverOverwrite

Where a host keeps exported files beside the poster, an export SHALL take the poster's name with the Office extension and SHALL never replace a file already there; a later export SHALL be numbered.

#### Scenario: ASecondExportIsNumbered
- **GIVEN** `Class rules.docx` already beside the poster
- **WHEN** the poster is exported to Word again
- **THEN** the new file is `Class rules (2).docx`, and the first is unchanged
