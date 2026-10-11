## ADDED Requirements

### Requirement: AWordDocumentIsCreatedFromMarkdown

The Open WebUI server SHALL offer a tool that takes a file name and Markdown, and writes a Word document
in a template's styles with pi-outpost's Word builder. Without a template named, it SHALL use a built-in
default template. The answer SHALL be an embed that offers the document as a download, named after the
given file name with the `.docx` extension, and shows its headings. Nothing SHALL be stored on the server.

#### Scenario: AReportIsCreatedWithTheDefaultTemplate
- **WHEN** `create_document` is called with a file name and Markdown holding headings, a list and a table, and no template
- **THEN** the answer embeds a `.docx` that opens as a Word package whose headings, list and table are those of the Markdown, in the default template's styles, and no file is written under the data directory

#### Scenario: TheDownloadIsTheDocument
- **GIVEN** the embed returned by `create_document`
- **WHEN** the reader presses the download button inside Open WebUI's sandbox
- **THEN** the browser receives a file named after the file name, whose bytes equal the document the server built

### Requirement: APresentationIsCreatedFromSlides

The Open WebUI server SHALL offer a tool that takes a file name and a list of slides — title, subtitle,
bullets, native table, native chart, diagram, Mermaid source, picture — and writes a PowerPoint deck with pi-outpost's
presentation builder, in a template or the built-in default. The answer SHALL be an embed offering the
deck as a `.pptx` download and listing its slide titles.

#### Scenario: ADeckIsCreatedWithTheDefaultTemplate
- **WHEN** `create_presentation` is called with a title slide, a bullet slide, a table slide and a chart slide, and no template
- **THEN** the embedded `.pptx` holds four slides in that order, with the titles, bullets, a native table and a native chart given

### Requirement: StructuredExchangeDiagramsAreDrawnInTheFile

A structured-exchange document given as a diagram — a `json` fence declaring the contract in the
Markdown, or a slide's `diagram` — SHALL be judged by the same gate as `show_structure`. A graph,
sequence or timeline SHALL be written as the figure pi-outpost's figure code draws for it, as an SVG
picture with a PNG of it behind; a table SHALL be written as a native table. A `json` fence that does
not declare the contract SHALL stay code.

#### Scenario: AGraphBecomesAPictureInWord
- **WHEN** `create_document` is called with Markdown holding a valid graph in a `json` fence
- **THEN** the document holds, in that place, an SVG picture equal to `serializeFigure` of that graph's figure, and a PNG fallback that is not empty

#### Scenario: ASequenceBecomesASlidePicture
- **WHEN** `create_presentation` is called with a slide whose `diagram` is a valid sequence
- **THEN** that slide holds an SVG picture equal to the sequence's figure, with a PNG fallback

#### Scenario: ATableDocumentBecomesANativeTable
- **WHEN** a valid structured-exchange table is given as a diagram, in Word and in PowerPoint
- **THEN** each file holds a native table with the document's rows, and no picture for it

#### Scenario: OrdinaryJsonStaysCode
- **WHEN** the Markdown holds a `json` fence that does not declare the structured-exchange contract
- **THEN** the document holds it as a code block

### Requirement: MermaidDiagramsAreDrawnInTheFile

A ` ```mermaid ` fence in a Word document, or a slide's `mermaid` source, SHALL be rendered by Mermaid
12 in the server, without a browser, and written as an SVG picture with a PNG of it behind. The picture
SHALL be what Mermaid draws for that source. A source Mermaid cannot parse SHALL refuse the whole call,
with Mermaid's message and the position of the fence or slide.

#### Scenario: MermaidDiagramIsDrawnInWord
- **WHEN** `create_document` is called with Markdown holding a valid flowchart in a ` ```mermaid ` fence
- **THEN** the document holds, in that place, an SVG picture and a PNG fallback that is not empty, and the SVG equals a fresh render of the same source but for the id each render is given

#### Scenario: MermaidDiagramIsDrawnOnASlide
- **WHEN** `create_presentation` is called with a slide whose `mermaid` is a valid sequence diagram
- **THEN** that slide holds an SVG picture with a PNG fallback, and its labels are the sequence's messages

#### Scenario: AnInvalidMermaidRefusesTheCall
- **WHEN** `create_document` is called with a ` ```mermaid ` fence whose source does not parse
- **THEN** no embed is returned, and the error names the fence's position and carries Mermaid's message

### Requirement: PicturesAreEmbeddedFromTheCall

A picture SHALL be embedded only when the call gives its bytes: a `data:` URI in Markdown image syntax,
or a slide's `image`. The server SHALL fetch no picture. A PNG, JPEG or GIF SHALL be embedded as given. A
picture that is SVG, does not decode, has a MIME type that does not match its bytes, or exceeds
`OUTPOST_MAX_IMAGE_BYTES` SHALL refuse the call.

#### Scenario: ADataUriPictureIsEmbedded
- **WHEN** `create_document` is called with Markdown holding `![logo](data:image/png;base64,…)` for a valid PNG
- **THEN** the document holds that PNG at that place, with its alternative text

#### Scenario: AnUnsupportedPictureIsRefused
- **WHEN** a call gives an SVG picture, or a `data:` URI whose bytes are not the MIME type it declares
- **THEN** no embed is returned, and the error names the picture's position and the reason

#### Scenario: AURLPictureIsNotFetched
- **WHEN** Markdown holds `![x](https://example.com/a.png)`
- **THEN** the server makes no request for it, no embed is returned, and the error names the picture's position and asks for its bytes as a `data:` URI

### Requirement: ARefusalExplainsWhatToFix

When a diagram or a picture is refused, a template cannot be used, a Mermaid source does not parse, or
the result exceeds the size limit, nothing SHALL be embedded. The answer SHALL be an error the model
reads, saying what was refused and why: for a diagram, which one (its position, and its title when it
has one), the gate's issues, and the guide topic that explains them; for a Mermaid source, Mermaid's
message; for a picture, its position and the reason.

#### Scenario: ARefusedDiagramRefusesTheDocument
- **WHEN** `create_document` is called with Markdown whose second diagram has a relationship naming a missing element
- **THEN** no embed is returned, and the error names the second diagram, carries issues equal to `show_structure`'s for that document, and names a guide topic

#### Scenario: ATooLargeResultIsRefused
- **GIVEN** `OUTPOST_MAX_FILE_BYTES` set below the size of the document asked for
- **WHEN** it is created
- **THEN** no embed is returned, and the error gives the limit and the size

### Requirement: TemplatesComeFromTheAdministratorsFolder

The server SHALL read templates only from `OUTPOST_TEMPLATES_DIR`, by file name. A `list_templates` tool
SHALL list them with their format and what each offers. A name holding a path separator or `..`, or
naming no file of that folder, SHALL be refused with the list of names. A template of the wrong format
for the tool SHALL be refused.

#### Scenario: AnAdministratorTemplateIsUsed
- **GIVEN** a `.dotx` with its own heading style in the templates folder
- **WHEN** `create_document` names it
- **THEN** the document's headings use that template's heading style

#### Scenario: TemplatesAreListed
- **GIVEN** a `.dotx` and a `.potx` in the templates folder
- **WHEN** `list_templates` is called
- **THEN** both are listed with their format; the Word one with its styles, the PowerPoint one with its layouts

#### Scenario: APathIsNotATemplateName
- **WHEN** a tool names the template `../config.json` or `sub/acme.dotx`
- **THEN** the call is refused with the names the folder offers, and nothing outside it is read

#### Scenario: AWordTemplateIsRefusedForADeck
- **WHEN** `create_presentation` names a `.dotx`
- **THEN** the call is refused, saying the template is a Word one

### Requirement: TheToolsAreBehindTheTrustBoundary

The three tools SHALL be served behind the same bearer key and user identity check as every other tool
of the server.

#### Scenario: AnUnsignedCallIsRefused
- **WHEN** `create_document` is called without the bearer key, or without a valid user identity in signed mode
- **THEN** it is refused before the body is read, as the planning tools are
