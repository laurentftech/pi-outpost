## Context

A Word paragraph's look is resolved in layers: document defaults, the paragraph style and its
`basedOn` chain, the character style, then formatting set directly on the paragraph (`w:pPr`)
and on each run (`w:rPr`). The last layer wins. Fonts may be named (`w:rFonts w:ascii="Arial"`)
or refer to the theme (`w:asciiTheme="minorHAnsi"`), in which case `theme1.xml` decides.

A document "in the wrong style" has the wrong definitions, direct formatting that beats them, or
both. Word's *Automatically update document styles* fixes only the first. This tool fixes both.

Reused: `readWordPackage`, `parseStyles`/`styleByName` (styles matched by name, stable across
languages), `WordComposer` (localized ids rewritten, numbering ids shifted), `docx_update`'s
revision writer, and `docx_render` to check the result.

## Decisions

### 1. The template's definitions replace the document's, matched by name

`styles.xml` and `theme1.xml` are the template's. Every style id the document uses is rewritten to
the template's id for the style of the same name, so a document from an English Word
(`Heading1`) keeps its headings on a French template (`Titre1`). A style the template lacks keeps
its definition, carried into the new `styles.xml`, and is named in the answer.

The numbering definitions the template's styles use (heading numbering) are carried in with ids
shifted past the document's, as the graft does. The document's own lists keep theirs.

### 2. Only fonts, sizes and colours are removed

Removed from run properties and paragraph-mark run properties: `w:rFonts`, `w:sz`, `w:szCs`,
`w:color`. That is what was asked, and it is the formatting that is almost never deliberate.
Everything else stays, including spacing and indentation set by hand, which are sometimes
deliberate (a signature block, a quotation).

The same applies to every story holding the document's text: body (tables and text boxes
included), headers, footers, footnotes, endnotes. Comments, drawings, charts and embedded objects
are left alone.

### 3. Page setup, headers and footers only on request

`include: ["page"]` gives every section the template's page size and margins (from its final
section) and keeps each section's orientation: a landscape section is structure, not style.
`include: ["headers"]` replaces the document's header and footer parts with the template's and
points every section at them. Neither is the default, because a document's own title-page footer
or section layout is often deliberate. A page setup change is tracked with `w:sectPrChange`; a
replaced header or footer part is not a revision, and the answer says so.

### 4. Tracked by default

A removed run property is recorded as the ISO/IEC 29500 schema provides (`CT_RPrChange`): the run
keeps a `w:rPrChange` by pi-outpost holding its old `w:rPr`. Word shows it as a formatting
revision. `track_changes: false` writes the result directly.

Replacing `styles.xml`, the theme and numbering is not a revision. The answer says so, and the
tool writes to a new file unless asked to overwrite: the original is the way back.

### 5. The text is proved unchanged

Before writing, the text of every paragraph of every story is compared with the original; if one
differs, nothing is written. A document with unaccepted revisions is refused, as `docx_update`
refuses one.

### 6. Published with the Word tools

`docx_restyle` joins `WORD_TOOLS`: published when a `.docx`/`.dotx` is named or the skill is
read, absent in a read-only sandbox. It shares `docx.maxBytes`.

## Non-goals

Legacy `.doc`; changing text, tables or pictures; turning bold short lines into headings;
applying the template's table styles; restyling comments or drawings.

## Open question

Confirm on Windows that Word shows the `w:rPrChange` revisions as formatting changes and that
*Reject all* restores each run's old formatting.
