## Context

Two writers of Word exist in the product's surroundings and neither takes a template:

- `ui/src/export/` maps Markdown to Word in the browser with the `docx` library (headings, lists,
  tables, emphasis, links, code, quotes, native equations, mermaid and referenced images as
  pictures). Its output uses the library's default styles.
- The server reads Word (`docx_extract`), reads and writes zips in-house (`zip.ts`,
  `zipWriter.ts`), and builds PowerPoint from a template by grafting slides into the template's
  package (`pptxBuild.ts`), then renders with an office application (`presentationRender.ts`).

This change reuses both: the export's mapping for *what* to write, the deck builder's grafting
and the renderer's pipeline for *where* and *how to check*.

## Decisions

### 1. One Markdown→Word mapping, moved to `shared/`

The browser export and the agent tool must write the same structure from the same Markdown, or a
document downloaded and a document the agent built will disagree on what a table or an equation
is. `markdownToDocx` and its helpers move to `shared/` (they depend on `docx`, `mdast` and the
equation converter, all of which run in Node and in the browser). Two things stay per side:
fetching a referenced image (the browser asks the server; the server reads the sandbox) and
drawing a mermaid diagram (browser only: the server tool writes the diagram's source as a code
block and says so, rather than shipping a headless browser).

### 2. Write with the library, then graft into the template

The library writes a complete package with its own `styles.xml`. The template's package is the
one kept; from the generated package only the body, its numbering definitions, its media and
their relationships are taken:

- **Body**: the generated `w:body` children replace the template's, and the template's final
  `w:sectPr` (page size, margins, headers, footers, columns) is kept as the body's last element.
- **Styles**: generated paragraphs reference style ids. They are rewritten to the template's ids,
  found by the style's **name**, not its id — Word writes localized ids (`Titre1` in a French
  template) but keeps the built-in names (`heading 1`). Mapping: heading 1–6, Normal, List
  Paragraph, Quote, Caption, and a monospaced style for code (the template's `HTML Preformatted`
  or a style the template calls code; otherwise the library's, added to the template's
  `styles.xml`). A style the template lacks is added from the generated package, never silently
  renamed.
- **Numbering**: generated `w:abstractNum` / `w:num` ids are shifted past the template's highest
  so both sets coexist; headings keep the template's own numbering (1, 1.1, …) because it lives on
  the template's heading styles.
- **Relationships and media**: generated image relationships are re-issued with ids unused in the
  template's `document.xml.rels`, media renamed to avoid the template's names, content types added.
- **Package**: a `.dotx`'s main part is re-typed as a document
  (`…wordprocessingml.document.main+xml`); the template's sample body goes, and with it any part
  that is no longer reachable (images used only by the sample), by the same reachability sweep as
  the deck builder. `settings.xml` is told to update fields on open so a table of contents fills.

Why not write straight into the template's XML: the mapping is already right, tested, and shared
with the export; writing it twice is how two writers drift.

### 3. What of the template's own body is kept

By default nothing: sample text is not content. `keep: ["cover", "toc"]` keeps the template's
cover page (a `w:sdt` with `docPartGallery="Cover Pages"`, or everything before the first section
break when the template marks its cover that way) and its table of contents (`w:sdt` with
`docPartGallery="Table of Contents"`, or a `TOC` field). `docx_styles` reports which of the two
the template has, so the agent asks for what exists.

### 4. Rendering: `pptx_render`'s pipeline, a Word path added

A `.docx` goes through the same converters; LibreOffice and ONLYOFFICE need no change beyond the
input type. Word by COM from PowerShell, paths in environment variables as for PowerPoint:
`Documents.Open(FileName, ConfirmConversions=False, ReadOnly=True, AddToRecentFiles=False, …,
Visible=False)` then `ExportAsFixedFormat(OutputFileName, wdExportFormatPDF = 17, …,
CreateBookmarks = wdExportCreateHeadingBookmarks = 1)`, then `Close` without saving; Word is told
to quit only when no other document is open in it. Constants read from Microsoft's VBA reference
(MicrosoftDocs/VBA-Docs: `Word.Documents.Open`, `Word.Document.ExportAsFixedFormat`,
`Word.WdExportFormat`, `Word.WdExportCreateBookmarks`).

The **text check** compares each body paragraph with the PDF's text layer, as for slides. For a
document it catches less (text flows onto the next page rather than off it) and one thing more:
content the template's fields or a broken style hid. It also reports the page count and the PDF's
heading bookmarks, which is how the agent sees that its chapters are chapters.

### 5. The viewer export with a template

The browser does the grafting too (the code is in `shared/`), with the template fetched from the
server. `docx.template` names the default; the export menu offers "with template" when one is
configured, and "plain" always stays — a template that fails to load reports why and does not
block the plain export. Without `docx.template` the button behaves exactly as today.

### 6. Settings

`docx.template` is new. The renderer settings are shared with presentations: the converters are
the same programs. They move to an `office` section (`office.renderer`, `office.libreofficePath`,
`office.onlyofficePath`, `office.renderTimeoutMs`), with `renderer` gaining `word`; the `pptx.*`
keys stay accepted as aliases so no configuration written for 0.29 breaks.

### 7. Publication

As for decks: published when a prompt names a `.dotx` (template tools only) or a `.docx`
(extractor and template tools), when `/skill:docx-from-template` is invoked, or when the agent
reads that skill or names such a path. `docx_create` is absent from read-only sandboxes.

## Risks / Trade-offs

- **Templates vary more than decks.** Style names are the stable handle, but a template may put
  its heading numbering on a list style rather than on the headings, or use content controls for
  everything. `docx_styles` reports what it found; the skill tells the agent to render and look.
- **Font substitution** in LibreOffice/ONLYOFFICE changes pagination; Word by COM is the reference
  when it is there.
- **Mermaid from the agent** travels as source code, not a picture (decision 1). A follow-up can
  render it server-side if that matters.
- **Not verifiable here**: Word by COM needs Windows with Office, as PowerPoint did.

## Open questions

1. Keep the `pptx.*` renderer keys as aliases indefinitely, or deprecate them with a warning?
2. Should `docx_create` also accept an existing `.docx` to *append* to, or only create?
