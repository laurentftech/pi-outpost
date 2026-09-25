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
is. `markdownToDocx` and its helpers move to `shared/src/docx/`.

**This adds dependencies to the server**, which until now avoided them (the Word reader and the
deck builder are in-house). `docx`, `unified`, `remark-parse`/`remark-gfm`/`remark-math` and
`katex` already ship to the browser in the UI bundle and are already in the lockfile; the project
owner chose to add them to the server rather than keep two Markdown→Word writers that would
drift. Two adjustments make the mapping portable:

- the equation transform read KaTeX's MathML through the browser's `DOMParser`; it now reads it
  with a small XML tree builder of its own (KaTeX's MathML is a closed, well-formed vocabulary);
- the two things only one side can do are injected: loading a referenced picture (the browser
  asks the server; the server reads the sandbox) and drawing a mermaid diagram (browser only —
  the server tool writes the diagram's source as a code block and says so, rather than shipping a
  headless browser).

### 2. Write with the library, then graft into the template

The library writes a complete package with its own `styles.xml`. The template's package is the
one kept; from the generated package only the body, its numbering definitions, its media and
their relationships are taken:

- **Body**: the generated `w:body` children replace the template's, and the template's final
  `w:sectPr` (page size, margins, headers, footers, columns) is kept as the body's last element.
- **Styles**: generated paragraphs reference style ids. They are rewritten to the template's ids,
  found by the style's **name**, not its id — Word writes localized ids (`Titre1` in a French
  template) but keeps the built-in names (`heading 1`). The mapping writes heading 1–6, List
  Paragraph and body text (Normal) by style; code, quotes and captions keep the direct
  formatting the viewer's export gives them. A style the template lacks is added from the
  generated package (under a free id), never silently replaced by another.
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

The browser builds the document exactly as the plain export does — diagrams and pictures are
the browser's to draw and fetch — and sends it to the server (`POST /files/docx-template`),
which carries its body into `docx.template` with the same `WordComposer` as `docx_create`. The
grafting stays on the server: it is built on the server's zip reader and writer and Node
buffers, and the template file is the server's to read. The template's path comes from the
configuration only, never from the request; the route checks the host and token like the other
file routes and is bounded by the Word ceiling. The export menu offers "word · template" when
one is configured, and the plain export always stays beside it — a template that cannot be used
answers with its reason and does not block the plain export. Without `docx.template` the button
behaves exactly as today.

### 6. Settings

`docx.template` is new. Rendering a document needs the settings `pptx_render` introduced in 0.29 —
which application draws, where LibreOffice and ONLYOFFICE are, how long a rendering may take —
because it drives the same programs. They are not presentation settings that happen to be named
`pptx`; they are office settings named after the first tool that needed them. They move to an
`office` section (`office.renderer`, `office.libreofficePath`, `office.onlyofficePath`,
`office.renderTimeoutMs`), with `renderer` gaining `word`. The `pptx.*` keys are **deprecated**:
still read, so no configuration written for 0.29 breaks, and each one used is named in a warning
at startup with its replacement. Their removal is a later release's decision.

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

### 8. Updating an existing document

Documents are also maintained, not only created. `docx_update` changes an existing `.docx` in
place of hand edits, and is built so that what it does not touch stays exactly as it was:

- **Addressed by heading, not by position.** An edit names a section by its heading path
  (`"2. Scope > 2.1 Out of scope"`), which is how people refer to parts of a document and what
  `docx_extract` already shows the agent. A path that matches no heading, or more than one, is
  refused with the headings that exist — never guessed.
- **Operations**: replace a section's body (keeping its heading), insert a new section after
  one, append at the end, delete a section. A section runs to the next heading of the same or a
  higher level. Content is Markdown, mapped as in `docx_create`, and **the document is its own
  template**: styles, numbering and section settings come from it.
- **Untouched content is not rewritten.** Only the edited ranges of `document.xml` change; every
  other part (headers, footers, comments, images of untouched sections, custom XML) is copied
  byte for byte. A paragraph outside the edited sections is identical before and after — this is
  the property the tests hold it to.
- **Tracked changes by default.** Edits are written as revisions (`w:ins` / `w:del`, authored
  "pi-outpost" with the time), so the document's owner reviews and accepts them in Word, as they
  would a colleague's. `track_changes: false` writes them directly. A document that already has
  pending revisions in an edited section is refused rather than stacked upon, since the result of
  editing someone's unaccepted change is ambiguous.
- **Written like `docx_create`:** to the writable zone, through a sibling file and a rename; the
  original is replaced only with `overwrite: true`, otherwise a new path is required.
- Content controls, fields and comments inside a replaced or deleted section are removed with
  it; the call reports how many, so the agent can say what went.

Tracked changes on by default was confirmed by the project owner.

Updating a PowerPoint deck is the same need, scoped separately: `add-pptx-update`.
