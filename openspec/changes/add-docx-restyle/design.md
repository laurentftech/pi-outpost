## Context

A Word paragraph's look is resolved in layers: document defaults (`w:docDefaults`), then the
paragraph style and its `basedOn` chain, then the character style, then the formatting set
directly on the paragraph (`w:pPr`) and on each run (`w:rPr`). The last layer wins. Fonts may be
named (`w:rFonts w:ascii="Arial"`) or refer to the theme (`w:asciiTheme="minorHAnsi"`), in which
case `theme1.xml` decides.

So a document "in the wrong style" is one or both of:

1. **wrong definitions**: its `styles.xml`, theme and numbering are not the template's;
2. **overrides**: direct formatting that beats whatever the styles say.

Fixing (1) alone is what Word's *Automatically update document styles* does, and it changes
little in a drifted document, because (2) still wins. Fixing (2) alone makes the document
consistent with its *old* styles. The tool does both, in that order.

What exists and is reused:

- `readWordPackage`, `parseStyles`, `styleByName` (styles matched by their name, which is stable
  across languages — `heading 1` under the id `Titre1` or `Heading1`);
- `WordComposer` (`docxGraft.ts`): style correspondence by name with a document's localized ids
  rewritten, and numbering definitions carried across with their ids shifted past the target's;
- `Revisions` (`docxUpdate.ts`): tracked-change markup attributed to `pi-outpost`;
- `docx_render`: page pictures, the chapters as the PDF's bookmarks, the text check.

## Decisions

### 1. The template's definitions replace the document's, matched by name

The document's `styles.xml` is replaced by the template's. Every style id the document uses is
rewritten to the template's id for the style of the same name: a document written by an English
Word (`Heading1`) moved onto a French template (`Titre1`) keeps its headings as headings. The
same for character, table and numbering styles.

A style the document uses and the template lacks is **kept**: its definition is carried into the
new `styles.xml`, with its `basedOn` pointed at the template's style of the same name when there
is one. It is listed in the answer. `style_map` (`{"Titre perso": "heading 2"}`) maps it onto a
template style instead: its paragraphs take that style, and its definition is not carried.

The theme (`theme1.xml`) is the template's: fonts that refer to the theme (`+mj-lt`, `+mn-lt`,
`w:asciiTheme`) follow it. The template's `w:docDefaults` and its latent styles come with its
`styles.xml`.

Heading numbering is part of the heading styles (`w:numPr` in the style). The template's
numbering definitions that its styles use are carried in with their ids shifted past the
document's, exactly as the graft does. **The document's own lists** — the `w:numPr` on its
paragraphs — keep their definitions and ids.

### 2. What counts as formatting to remove

By default, removed from runs (`w:rPr`) and from the paragraph mark:

| Removed by default | Why |
|---|---|
| `w:rFonts` (named and theme fonts) | the font is the style's |
| `w:sz`, `w:szCs` | the size is the style's |
| `w:color` | the colour is the style's |

Kept, always:

| Kept | Why |
|---|---|
| `w:b`, `w:i`, `w:u`, `w:strike`, `w:dstrike` | emphasis a writer chose; removing it changes meaning |
| `w:vertAlign` (superscript, subscript) | part of the text (`m²`, `H₂O`) |
| `w:highlight` | a reader's mark |
| `w:lang`, `w:noProof`, `w:rtl`, `w:cs` | language and direction, not look |
| `w:rStyle` | a character style is a style; it is remapped by name like the others |

`clear` widens the set, per call: `"spacing"` (`w:spacing` on paragraphs), `"indentation"`
(`w:ind`, except on list paragraphs, whose indentation the numbering sets), `"alignment"`
(`w:jc`), `"shading"` (`w:shd` on runs and paragraphs). The default is only fonts, sizes and
colours because that is what was asked, and because spacing and indentation set by hand are
sometimes deliberate (a signature block, a quotation) in a way a font rarely is.

The same rules apply to every story that holds the document's text: the body with its tables and
text boxes, headers and footers (unless replaced — decision 4), footnotes and endnotes. Comments
are someone's notes, not the document, and are left alone. Drawings, charts and embedded objects
keep their own formatting.

### 3. Tracked by default, and what cannot be tracked

WordprocessingML records a formatting change as the formatting that was there before, kept
beside the new one (the ISO/IEC 29500 schema's `CT_RPrChange`, `CT_PPrChange`,
`CT_SectPrChange`):

- a run whose font is removed gets `<w:rPrChange w:author="pi-outpost" …><w:rPr>…the old run
  properties…</w:rPr></w:rPrChange>` inside its new `w:rPr`;
- a paragraph whose spacing is removed gets `w:pPrChange` with its old paragraph properties
  (without `w:rPr`, `w:sectPr` and `w:pPrChange`, which `CT_PPrBase` does not hold);
- a paragraph mark's own run properties get the same through `w:rPrChange` in `w:pPr/w:rPr`;
- a page setup replaced on request gets `w:sectPrChange`.

Word shows these as *Formatted: …* balloons; accepting them keeps the new look, rejecting one
puts that run's old formatting back. `track_changes: false` writes the result directly.

**Style definitions, the theme and numbering definitions are not revisions.** Word records edits
to a paragraph's formatting, not a replaced `styles.xml`. Rejecting every tracked change therefore
gives back the document's hand formatting over the *template's* styles, not the original document.
The answer says this in one line, and the tool writes to a new file unless the call names
`overwrite: true`, so the original is the way back.

### 4. Page setup, headers and footers only on request

`include: ["page"]` replaces each section's page size, margins and orientation with the
template's final section's. `include: ["headers"]` replaces the document's header and footer parts
with the template's and repoints every section's references. Neither is the default: a document's
landscape section or its own title-page footer is structure, not style, and a template has one
page setup where a document may have several sections. When the document has more than one
section, `"page"` applies the template's size and margins but keeps each section's orientation,
and the answer says how many sections there were.

### 5. The text is proved unchanged before anything is written

Before writing, the tool reads the text of every paragraph of every story it touched, before and
after, and compares them. If one differs, it writes nothing and fails, naming the paragraph.
Restyling must never change a word; this makes that a checked property of every run of the tool
rather than a hope about its code. A document with revisions nobody has accepted yet is refused,
as `docx_update` refuses one: formatting changes laid over someone's pending insertion leave its
meaning to chance.

### 6. What a person has to decide is reported, not guessed

- **Styles the template lacks**: listed with how many paragraphs use each, and suggested
  `style_map` entries where a template style has a close name.
- **Lookalike headings**: paragraphs in a body style, shorter than a line, whole-paragraph bold or
  larger than the body size, followed by body text — listed with their text and page. They are not
  turned into headings: a bold short line is as often a table caption or a label as a heading,
  and making a heading changes the outline and the table of contents. (See Open questions.)
- **What was removed**, counted by kind (fonts, sizes, colours, …) and by style, so the answer
  reads "412 runs had a font set by hand, 380 of them Calibri in Normal".

`dry_run: true` returns this report and writes nothing.

### 7. One tool, published with the Word tools

`docx_restyle` joins `WORD_TOOLS`: published when a `.docx`/`.dotx` is named or the
`docx-from-template` skill is read; absent in a read-only sandbox, like `docx_create` and
`docx_update`. It shares `docx.maxBytes` and the renderer settings.

## Non-goals

- Legacy `.doc`, `.docm` and `.rtf`.
- Rewriting content: no text, table structure or picture changes.
- Converting lookalike headings, bulleted-by-hand lines (`- `, `• ` typed as text) or numbered-by-
  hand headings into real headings and lists (reported only in this change).
- Restyling comments, drawings, charts or embedded objects.

## Risks

- **A document whose meaning is in its formatting** (colours used as a legend, a red "draft"
  mark): removing colours loses it. Mitigated by `dry_run`, by tracking, and by `clear` being
  explicit; the skill tells the agent to look at the dry-run report for colours before running.
- **Theme-only fonts in the template**: a document font set by name (`Arial`) is removed and the
  theme's font applies. That is the intent, but a template whose theme differs from what its
  author sees in Word would surprise; the render step is what catches it.
- **Very long documents**: every run is visited. Bounded by `docx.maxBytes`, as reading is.

## Open questions

1. The default removal set: fonts, sizes and colours was the request. Should paragraph spacing be
   in the default for this colleague's documents? To settle on one of her real documents.
2. Lookalike headings: report only (this change), or an opt-in `promote_headings` that makes them
   headings at a level inferred from their size? Deferred until the report has been seen on real
   documents.
3. Tables without a style: give them the template's default table style? Tempting and visible;
   left out until asked, because a table's borders are often deliberate.
4. Confirm on Windows that Word presents `w:rPrChange` written this way as formatting revisions
   and that *Reject all* restores each run as described.
