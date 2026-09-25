## ADDED Requirements

### Requirement: RestyleADocumentToATemplate

The system SHALL provide a `docx_restyle` tool that, given an existing `.docx` and a Word template
(`.dotx` or `.docx`), writes a copy of the document in the template's house style:

- the template's style definitions, document defaults, theme and the numbering its styles use
  SHALL replace the document's; every style the document uses SHALL be matched to the template's
  style of the same name and its id rewritten; a style the template lacks SHALL be kept and
  reported, unless `style_map` maps it onto a template style;
- formatting set directly on runs and paragraph marks that overrides the styles SHALL be removed:
  fonts, sizes and colours by default, and paragraph spacing, indentation (except on list
  paragraphs), alignment and shading when `clear` names them;
- bold, italic, underline, strike-through, superscript and subscript, highlight, language and
  character styles SHALL be kept;
- the document's own lists SHALL keep their numbering; its text, tables, pictures, fields, content
  controls and comments SHALL be unchanged;
- the same rules SHALL apply to the body (tables and text boxes included), headers and footers,
  footnotes and endnotes; comments, drawings, charts and embedded objects SHALL be left alone;
- the template's page setup, and its headers and footers, SHALL replace the document's only when
  `include` names `"page"` or `"headers"`.

Before writing, the tool SHALL compare the text of every paragraph of every story it changed with
the original and SHALL write nothing if any differs. A document holding revisions not yet
accepted SHALL be refused.

The removals SHALL be written as tracked formatting changes attributed to pi-outpost unless the
call passes `track_changes: false`. The answer SHALL say that the replaced style definitions,
theme and numbering are not revisions. It SHALL count what was removed by kind and by style, list
the styles the template lacks and the paragraphs that look like headings without being headings,
and SHALL NOT turn those paragraphs into headings. `dry_run: true` SHALL return the same answer
without writing.

The result SHALL be written to the writable zone, and SHALL replace an existing file only when
asked to.

#### Scenario: DocumentTakesTheTemplatesStyles
- **GIVEN** a document written by an English Word, whose heading 1 is Arial 16 pt under the id `Heading1`
- **WHEN** it is restyled with a template whose heading 1 is another font under the id `Titre1`
- **THEN** its headings reference `Titre1`, `styles.xml` holds the template's definition of heading 1, and `theme1.xml` is the template's

#### Scenario: HandSetFontsSizesAndColoursAreRemoved
- **GIVEN** a Normal paragraph whose runs set Calibri, 11 pt and a colour by hand
- **WHEN** the document is restyled with the defaults
- **THEN** those runs set no font, size or colour, so the paragraph takes Normal's from the template

#### Scenario: MeaningfulFormattingIsKept
- **GIVEN** runs that are bold, italic, underlined, struck through, superscript, subscript and highlighted, each also with a font set by hand
- **WHEN** the document is restyled
- **THEN** each keeps its emphasis, position and highlight, and only the font is gone

#### Scenario: SpacingIsClearedOnlyWhenAsked
- **GIVEN** paragraphs with spacing and indentation set by hand, one of them in a list
- **WHEN** the document is restyled without `clear`, then with `clear: ["spacing", "indentation"]`
- **THEN** the first result keeps both; the second removes both except the list paragraph's indentation

#### Scenario: HeadingNumberingFollowsTheTemplateAndListsKeepTheirs
- **GIVEN** a template whose headings are numbered, and a document with a numbered list of its own
- **WHEN** the document is restyled
- **THEN** its headings are numbered by the template's definitions, and the list keeps its own numbering definition and restarts where it did

#### Scenario: EveryStoryIsRestyled
- **GIVEN** a document with hand-set fonts in a table cell, a text box, a header and a footnote
- **WHEN** it is restyled
- **THEN** the font is removed in all four, and a comment with a hand-set font keeps it

#### Scenario: TheTextIsUnchanged
- **WHEN** any document is restyled
- **THEN** the text of every paragraph of every story is the same as before, and the tool fails without writing if it would not be

#### Scenario: RemovalsAreTrackedByDefault
- **WHEN** a document is restyled without `track_changes: false`
- **THEN** every run whose formatting changed carries a `w:rPrChange` by pi-outpost holding its old run properties, every changed paragraph a `w:pPrChange`, and the answer says the style definitions are not tracked

#### Scenario: UnknownStylesAreReportedOrMapped
- **GIVEN** a document with a custom paragraph style "Titre perso" the template does not have
- **WHEN** it is restyled without `style_map`, then with `style_map: {"Titre perso": "heading 2"}`
- **THEN** the first result keeps the style and lists it with its paragraph count; the second puts those paragraphs in the template's heading 2 and does not carry "Titre perso"

#### Scenario: LookalikeHeadingsAreReportedNotConverted
- **GIVEN** a Normal paragraph of three words in bold 14 pt followed by body text
- **WHEN** the document is restyled
- **THEN** the answer lists it as a possible heading with its text, and it stays a Normal paragraph

#### Scenario: PageSetupAndHeadersOnlyOnRequest
- **GIVEN** a template with other margins and its own header
- **WHEN** the document is restyled without `include`, then with `include: ["page", "headers"]`
- **THEN** the first result keeps the document's margins and header; the second has the template's

#### Scenario: PendingRevisionsAreRefused
- **GIVEN** a document with an insertion nobody has accepted
- **WHEN** it is restyled
- **THEN** the call is refused, says why, and nothing is written

#### Scenario: ADryRunWritesNothing
- **WHEN** `docx_restyle` is called with `dry_run: true`
- **THEN** it returns the counts and lists a real run would, and no file is written

#### Scenario: TheOriginalIsKeptUnlessOverwriteIsAsked
- **WHEN** `docx_restyle` is called without `overwrite`
- **THEN** the original file is unchanged and the result is written to `output_path`
