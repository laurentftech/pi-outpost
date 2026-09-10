## ADDED Requirements

### Requirement: ReferencedImagesTravelAsPictures

Where the source document references an image held in the workspace, the export SHALL carry that
image as a picture in the package, rather than as the text of its reference.

The reference SHALL be resolved the way the viewer resolves it while displaying the document: a
relative reference resolves against the directory of the document being exported — beside it, below
it, or above it — and a workspace-absolute reference resolves from the workspace root. What the
reader sees rendered on screen and what the export carries SHALL therefore be the same picture; a
reference that draws in the viewer and disappears in the export is the failure this requirement
exists to prevent.

A referenced vector image SHALL be embedded under the same rule a rendered diagram is:
`DiagramsAreEmbeddedAsVectorWithRasterFallback` governs it, so Word draws the vector at any zoom and
a reader without the Office extension is shown a raster of the same picture rather than a broken
one. A referenced raster image SHALL be embedded as the format it already is, without being
redrawn. The formats a package can carry as pictures are PNG, JPEG, GIF and BMP; a raster in any
other format has no part it could become, and degrades to its alt text under the rule below. Every
embedded picture SHALL declare a physical size derived from the image's own dimensions and SHALL be
constrained to the page's text width when it would otherwise exceed it.

An image the export cannot obtain SHALL degrade to the reference's alt text, exactly as an
unreferenced image does today: a file that no longer exists, a path the server refuses, and a
payload that is not a readable image are all local failures. Such a failure MUST NOT fail the
export, MUST NOT stop the rest of the document from being carried, and MUST NOT produce an image
part the package refers to but does not contain.

An image referenced by an absolute URL SHALL NOT be fetched, and SHALL degrade to its alt text —
the export does not reach off the origin to complete a document.

#### Scenario: AFigureBesideTheDocumentIsCarried
- **GIVEN** a Markdown document referencing an image file in its own directory
- **WHEN** the document is exported
- **THEN** the package contains that image as a picture, and its alt text does not appear as the paragraph's text

#### Scenario: AFigureInAnotherDirectoryIsCarried
- **GIVEN** a Markdown document referencing an image in a subdirectory and one in a parent directory
- **WHEN** the document is exported
- **THEN** both are carried as pictures, resolved against the document's own directory

#### Scenario: AReferencedVectorIsVectorInWord
- **GIVEN** a document referencing a vector figure
- **WHEN** the export is opened in Word
- **THEN** the picture is drawn from the vector and stays sharp when enlarged, and the package also contains a raster of the same picture as its fallback

#### Scenario: WhatTheViewerShowsIsWhatTheExportCarries
- **GIVEN** a document whose referenced image the viewer displays
- **WHEN** the document is exported
- **THEN** the exported picture is that same image

#### Scenario: AMissingReferenceFallsBackToItsText
- **GIVEN** a document referencing an image that does not exist, or one the server refuses to serve
- **WHEN** the document is exported
- **THEN** that reference appears as its alt text, the rest of the document is carried unaffected, the export succeeds, and the package contains no relationship without a part

#### Scenario: AnAbsoluteUrlIsNotFetched
- **GIVEN** a document referencing an image by an absolute URL
- **WHEN** the document is exported
- **THEN** no request is made for it and the reference appears as its alt text

## MODIFIED Requirements

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

Conversion SHALL NOT reach beyond the origin that served the application: no font, script, style or
theme SHALL be fetched to produce a document, and no content of the exported document SHALL be sent
anywhere. The inputs are the document's own text and the workspace files that text references,
which the application reads through the same confined route it reads them for display.

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
- **THEN** every request it makes stays on the application's own origin, and nothing is sent off it
