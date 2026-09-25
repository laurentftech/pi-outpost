## ADDED Requirements

### Requirement: ListTemplateStyles

The system SHALL provide a `docx_styles` tool that, given a Word template (`.dotx`) or document
(`.docx`), reports the styles the written content will use and what the template holds of its own:
for each of heading 1–6, body text, list, quote, caption and code, the template style it maps to
(by name) and whether headings are numbered; the table styles; whether the template has a cover
page, headers or footers, and a table of contents; and the length of its sample body.

A file that is not a usable template — not an Office package, encrypted or a legacy binary file,
macro-enabled, damaged, or declaring a DOCTYPE — SHALL be refused with the reason.

#### Scenario: StylesAreReportedByRole
- **WHEN** `docx_styles` is called on a template whose headings are named `heading 1`…`heading 6` under localized ids
- **THEN** each heading level is reported with the template's own style id and name, and whether it is numbered

#### Scenario: TemplateFeaturesAreReported
- **GIVEN** a template with a cover page, a header, a footer and a table of contents
- **WHEN** it is read
- **THEN** all four are reported as present

#### Scenario: AnUnusableWordTemplateIsRefusedWithItsReason
- **WHEN** the file is encrypted, not a zip, not a Word document, macro-enabled or declares a DOCTYPE
- **THEN** the call fails with a message saying which

### Requirement: BuildADocumentFromATemplate

The system SHALL provide a `docx_create` tool that writes a new `.docx` from a template and
Markdown. The Markdown SHALL be mapped with the same mapping as the viewer's Word export, and the
result SHALL be placed into the template's package so that the template's styles, heading
numbering, section settings, headers, footers and theme apply to it.

Written paragraphs SHALL carry the template's styles, matched by style name. A style the content
needs and the template lacks SHALL be added to the document rather than replaced by another. The
content's list numbering SHALL coexist with the template's without renumbering either.

The template's sample body SHALL NOT appear in the document, except its cover page and table of
contents when the call asks to keep them and the template has them. A kept table of contents SHALL
be set to update when the document is opened.

The output SHALL be a Word document (`.docx`) whatever the template was, SHALL be written only in
the writable zone, and SHALL replace an existing file only when asked to.

#### Scenario: ContentWearsTheTemplatesStyles
- **GIVEN** a template whose first-level heading style has the id `Titre1` and the name `heading 1`
- **WHEN** a document with `# Introduction` is created from it
- **THEN** that paragraph references `Titre1`, and the template's style definitions are the document's

#### Scenario: HeadersFootersAndPageSetupAreKept
- **WHEN** a document is created from a template with a header, a footer and custom margins
- **THEN** the document's final section carries the template's header and footer references and margins

#### Scenario: SampleBodyIsDropped
- **GIVEN** a template whose body holds sample text
- **WHEN** a document is created from it without `keep`
- **THEN** none of the sample text is in the document, and parts reachable only from it are gone

#### Scenario: CoverAndTableOfContentsAreKeptOnRequest
- **GIVEN** a template with a cover page and a table of contents
- **WHEN** a document is created with `keep: ["cover", "toc"]`
- **THEN** both precede the content, and the document asks Word to update fields on open

#### Scenario: ListsImagesAndTablesSurviveTheGraft
- **WHEN** Markdown with an ordered list, a table and a referenced image is written into a template that has numbering of its own
- **THEN** the list is numbered, the template's numbering is unchanged, the table is present, and the image resolves to a part in the package

#### Scenario: ATemplateBecomesADocument
- **WHEN** a document is created from a `.dotx`
- **THEN** its main part is typed as a document, not a template

#### Scenario: AnExistingDocumentIsKeptUnlessOverwriteIsAsked
- **GIVEN** the output path exists
- **WHEN** `docx_create` is called without `overwrite`
- **THEN** the call fails and the file is unchanged

### Requirement: RenderADocumentForChecking

The system SHALL provide a `docx_render` tool that has an office application draw a Word document —
Word on Windows, LibreOffice or ONLYOFFICE Document Builder, chosen as for presentations — and
returns a picture of each page up to a limit, the page count, the heading bookmarks of the PDF, and
a check naming every body paragraph absent from the PDF's text. It MAY save the PDF in the writable
zone. Stopping the turn SHALL stop the conversion.

Word SHALL be opened read-only on a private copy and SHALL be told to quit only when no other
document is open in it.

#### Scenario: PagesHeadingsAndTextAreReported
- **WHEN** a document with two chapters is rendered
- **THEN** the result holds its page pictures, its page count, the two chapters as bookmarks, and a clean text check

#### Scenario: MissingTextIsNamed
- **GIVEN** a document with a paragraph that does not reach the PDF
- **WHEN** it is rendered
- **THEN** the text check names that paragraph

#### Scenario: WordIsDrivenWithoutDisturbingTheUser
- **WHEN** Word renders on Windows while the user has a document open in it
- **THEN** the rendering opens a read-only copy invisibly, closes it without saving, and leaves Word running

### Requirement: UpdateAnExistingDocument

The system SHALL provide a `docx_update` tool that changes an existing `.docx` by sections, each
edit naming its section by heading path: replace a section's body keeping its heading, insert a new
section after one, append at the end, or delete a section. A section SHALL run from its heading to
the next heading of the same or a higher level. Content SHALL be Markdown, mapped as for
`docx_create`, using the document's own styles and numbering.

A heading path that matches no heading or several SHALL be refused with the document's headings.
Everything outside the edited sections SHALL be left identical: its paragraphs unchanged in
`document.xml`, and every part the edits do not need to change — the new content's styles,
numbering, pictures and links need theirs — copied unchanged.

Edits SHALL be written as tracked changes attributed to pi-outpost unless the call asks otherwise.
An edit to a section holding revisions not yet accepted SHALL be refused. Content controls, fields
and comments removed with a section SHALL be counted in the result.

The result SHALL be written to the writable zone, and SHALL replace the original only when asked to.

#### Scenario: ASectionIsReplacedAndTheRestIsUntouched
- **GIVEN** a document with sections 1, 2 and 3
- **WHEN** section 2's body is replaced
- **THEN** section 2 holds the new content under its original heading, and every paragraph of sections 1 and 3, and every part the new content does not need, is byte-identical to the original

#### Scenario: EditsAreTrackedChangesByDefault
- **WHEN** a section is replaced without `track_changes: false`
- **THEN** the removed paragraphs are marked deleted and the new ones inserted, attributed to pi-outpost

#### Scenario: AnUnknownOrAmbiguousHeadingIsRefused
- **WHEN** the heading path matches no heading, or two headings
- **THEN** the call fails, lists the document's headings, and the document is unchanged

#### Scenario: InsertAndDeleteFollowTheOutline
- **WHEN** a section is inserted after "2. Scope" and "3. Risks" is deleted
- **THEN** the new section sits after all of section 2's subsections, and section 3 with its subsections is gone

#### Scenario: PendingRevisionsAreNotEditedOver
- **GIVEN** a section with an unaccepted tracked change
- **WHEN** an edit targets it
- **THEN** the call is refused and says why

#### Scenario: NewContentWearsTheDocumentsStyles
- **GIVEN** a document whose heading styles have localized ids
- **WHEN** a section with a subheading and a list is inserted
- **THEN** the subheading uses the document's second-level heading style, and the list its numbering
