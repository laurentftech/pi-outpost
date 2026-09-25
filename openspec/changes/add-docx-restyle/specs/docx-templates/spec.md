## ADDED Requirements

### Requirement: RestyleADocumentToATemplate

The system SHALL provide a `docx_restyle` tool that, given an existing `.docx` and a Word template
(`.dotx` or `.docx`), writes a copy of the document in the template's house style:

- the template's style definitions, theme and the numbering its styles use SHALL replace the
  document's; every style the document uses SHALL be matched to the template's style of the same
  name and its id rewritten; a style the template lacks SHALL be kept and named in the answer;
- fonts, sizes and colours set directly on runs and paragraph marks SHALL be removed, in the body
  (tables and text boxes included), headers and footers, footnotes and endnotes;
- every other formatting — bold, italic, underline, strike-through, superscript and subscript,
  highlight, spacing, indentation — SHALL be kept;
- the document's own lists, its text, tables, pictures, fields and comments SHALL be unchanged.

Before writing, the tool SHALL compare the text of every paragraph with the original and SHALL
write nothing if any differs. A document holding revisions not yet accepted SHALL be refused.

The removals SHALL be written as tracked formatting changes attributed to pi-outpost unless the
call passes `track_changes: false`; the answer SHALL say that the replaced style definitions are
not tracked. The result SHALL be written to the writable zone, and SHALL replace an existing file
only when asked to.

#### Scenario: DocumentTakesTheTemplatesStyles
- **GIVEN** a document written by an English Word, whose heading 1 is Arial 16 pt under the id `Heading1`
- **WHEN** it is restyled with a template whose heading 1 is another font under the id `Titre1`
- **THEN** its headings reference `Titre1`, `styles.xml` holds the template's definition of heading 1, and `theme1.xml` is the template's

#### Scenario: HandSetFontsSizesAndColoursAreRemoved
- **GIVEN** runs in the body, a table cell, a header and a footnote that set a font, a size and a colour by hand
- **WHEN** the document is restyled
- **THEN** none of them sets a font, size or colour any more

#### Scenario: OtherFormattingIsKept
- **GIVEN** runs that are bold, italic, underlined, superscript and highlighted, and a paragraph with spacing set by hand, each also with a font set by hand
- **WHEN** the document is restyled
- **THEN** only the fonts are gone

#### Scenario: HeadingNumberingFollowsTheTemplateAndListsKeepTheirs
- **GIVEN** a template whose headings are numbered, and a document with a numbered list of its own
- **WHEN** the document is restyled
- **THEN** its headings are numbered by the template's definitions, and the list keeps its own

#### Scenario: AStyleTheTemplateLacksIsKept
- **GIVEN** a document with a custom paragraph style the template does not have
- **WHEN** it is restyled
- **THEN** its paragraphs keep that style, and the answer names it

#### Scenario: TheTextIsUnchanged
- **WHEN** any document is restyled
- **THEN** the text of every paragraph is the same as before, and the tool fails without writing if it would not be

#### Scenario: RemovalsAreTrackedByDefault
- **WHEN** a document is restyled without `track_changes: false`
- **THEN** every changed run carries a `w:rPrChange` by pi-outpost holding its old run properties, and the answer says the style definitions are not tracked

#### Scenario: PendingRevisionsAreRefused
- **GIVEN** a document with an insertion nobody has accepted
- **WHEN** it is restyled
- **THEN** the call is refused, says why, and nothing is written

#### Scenario: TheOriginalIsKeptUnlessOverwriteIsAsked
- **WHEN** `docx_restyle` is called without `overwrite`
- **THEN** the original file is unchanged and the result is written to `output_path`
