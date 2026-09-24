## Context

`pptx_extract` reads decks with an in-house zip reader and XML scanner, because deployments are
air-gapped and a dependency is something a security team vendors and re-reviews (docx change,
decision 1). Tools are confined per argument: `scopeToRoot` confines a parameter named `path`,
and every other path argument is checked by the tool itself against the readable or writable
zone. Extractors are published on demand to keep the prompt floor low.

The request: create PowerPoint presentations on Windows from a template, as a tool and a skill;
render with PowerPoint (or a compatible suite such as ONLYOFFICE) so the agent checks readability
inside its own loop; use Anthropic's `pptx` skill as the model.

## Decisions

### 1. Generate the package ourselves; drive PowerPoint only to render

Both engines were on the table: writing OOXML directly, or automating PowerPoint through COM. The
user chose both. The deck is **written in Node** — deterministic, testable on CI, runs where no
Office is installed (a server, a Linux box, the single-file build) — and **PowerPoint is used for
what only it can do**: draw the deck exactly as the audience will see it. COM automation writing
the deck would have made creation Windows-only, untestable, and fragile under a service account.

No generator library (pptxgenjs, python-pptx) is added: neither fills an existing template's
layouts without a runtime this product does not ship, and the package format needed here —
slides whose shapes reference layout placeholders — is small.

### 2. Content goes into placeholders, not free text boxes

A slide shape carrying `<p:ph type=… idx=…>` matching its layout inherits position, font, size,
colour, bullets and autofit from the layout and master. That is what "use the template" means; a
text box drawn at the same coordinates only imitates it and breaks when the theme changes. Shapes
are written with an empty `spPr`, except where the tool must place something itself (a picture, or
text sharing a placeholder with one).

Positions are still needed to place pictures, so layout placeholders without an `a:xfrm` inherit
the master's placeholder of the corresponding type (title/ctrTitle → title; dt/ftr/sldNum/hdr → the
same; everything else → body), which is PowerPoint's own inheritance rule.

### 3. The template's own slides are swept by reachability

A `.pptx` used as a template usually holds sample slides; the user wants the design, not them. The
output is rebuilt from the template's parts minus what is no longer reachable from the package
root once the presentation's slide relationships are cut: the slides, their notes, comments,
charts and media go; masters, layouts, theme, fonts and properties stay. Presentation-level lists
that name slides — custom shows and the section list extension — are removed with them, since
PowerPoint reports a dangling reference as damage. Every other extension is kept verbatim.

### 4. SVG: the Office 2016 extension plus a real raster fallback

An SVG picture is `a:blip r:embed=<png>` carrying `asvg:svgBlip r:embed=<svg>` under the extension
URI `{96DAC541-7B7A-43D3-8B79-37D633B846F1}`. The PNG is drawn by `@napi-rs/canvas` when it is
installed — it already is, as pdf.js's optional dependency — and is a transparent pixel with a
warning otherwise. SVGs that reference anything outside themselves (external `href`, `url(…)`,
`@import`) or declare a DOCTYPE are refused: every renderer downstream would be asked to fetch.
The canvas's `loadImage` treats a string as a path or URL, so only bytes are ever passed to it.

### 5. Rendering: office application → PDF → pictures and a text check

Each converter produces a PDF, which is then rasterised in-process with pdf.js and the canvas —
one pipeline for three applications, and PNGs the model can see.

- **PowerPoint**: PowerShell, `New-Object -ComObject PowerPoint.Application`,
  `Presentations.Open(path, ReadOnly=-1, Untitled=0, WithWindow=0)`, `SaveAs(pdf, 32)`
  (ppSaveAsPDF). Paths travel in environment variables, never in the script text. PowerPoint is a
  single shared instance: it is told to quit only when no presentation is left open in it, so the
  user's own decks are never closed. `Application.Visible = false` is not set — PowerPoint refuses
  it; `WithWindow=0` is the supported way to stay out of sight.
- **LibreOffice**: `soffice --headless --convert-to pdf --outdir <dir>` with a private
  `-env:UserInstallation` profile (a running LibreOffice otherwise swallows the request, and a
  profile that cannot be created aborts it) and `SAL_USE_VCLPLUGIN=svp` off Windows. On Windows
  `soffice.com` is preferred: it waits for the conversion.
- **ONLYOFFICE Document Builder**: `docbuilder <script>` where the script is
  `builder.OpenFile(…)`, `builder.SaveFile("pdf", …)`, `builder.CloseFile()`, paths written as
  JSON string literals.

Every converter works on a copy of the deck in a private temporary directory, removed afterwards.
The turn's abort signal is handed to the converter's process: stopping the agent terminates the
conversion instead of leaving PowerPoint or LibreOffice running until the timeout.

The **text check** compares each slide's paragraphs (read with the extractor's own slide parser)
with the text layer of the matching PDF page, ignoring whitespace and bullet glyphs. Verified on a
real LibreOffice rendering: text past the bottom of a slide is clipped out of the PDF entirely, so
a paragraph missing from the page is text the audience will not see. This catches overflow even
where no canvas is available and does not depend on the model noticing it in a picture.

### 6. Publication follows the extractors, with agent-side triggers of its own

The three tools are published together, when a prompt names a `.potx` (presentation tools only)
or a `.pptx` (extractor and presentation tools), and when the prompt invokes
`/skill:pptx-from-template`. Because models load a skill by reading its `SKILL.md`, and may find a
template with `find`, a tool call reading that file or naming a `.pptx`/`.potx` path publishes them
inside the same turn.

**Discrepancy found and resolved.** The `agent` spec states that naming a document again is the
only way back for a withdrawn extractor, and that it belongs to the user. A first draft let the
agent-side trigger republish `pptx_extract` too. That would have silently changed an existing
contract, so agent-side triggers publish only the presentation tools; the extractor rule is
unchanged.

### 7. Tables and charts are native, their data embedded

A picture of a chart cannot be corrected by the person presenting it, does not follow the theme,
and is what the reference skill warns against. So a table is an `a:tbl` in PowerPoint's default
table style (`{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}`, which colours itself from the theme), and a
chart is a `c:chartSpace` part:

- series filled with `schemeClr accent1…6`, never fixed colours, so the template decides them;
- values cached in the part (what every reader draws) and also written to an embedded workbook
  (`ppt/embeddings/Microsoft_Excel_SheetN.xlsx`, linked by `c:externalData` with
  `autoUpdate=0` through a `package` relationship) laid out where the cell references point, so
  *Edit Data* opens the numbers. The workbook is written with the in-house zip writer and inline
  strings — no dependency, no shared-strings part;
- element orders taken from ECMA-376 and checked against python-pptx's chart writer; `dLblPos` is
  never written, since `outEnd` is refused on stacked bars and every type has a sensible default;
- a horizontal bar chart runs its categories top to bottom (`maxMin`, value axis crossing at
  `max`), the order people read a ranked list in.

One visual per slide keeps the placement rules simple and the slides readable; a table or chart
never goes into a picture placeholder. The limits (20 rows, 10 columns, 50 categories, 10 series)
are about readability on a slide, not about the format.

Verified beyond the unit tests: every chart type and a table rendered through LibreOffice and looked
at; the generated decks passed an OOXML XSD and PowerPoint-constraint validator (the one shipped
with Anthropic's `pptx` skill, run locally, not copied), including its chart checks; the embedded
workbooks read back through this repository's own `.xlsx` extractor.

### 8. Where the tools exist

`pptx_layouts` and `pptx_render` are reading (a render's `pdf_path` is measured against the
writable zone, exactly like an extractor's `output_path`). `pptx_create` writes, so it is
registered only where writing is: not at all in a read-only sandbox. Output must end in `.pptx`
(the package is a presentation, whatever the template was); an existing file is replaced only
with `overwrite: true`, through a sibling file and a rename.

## Risks / Trade-offs

- **Font substitution.** LibreOffice and ONLYOFFICE replace fonts they lack, so their line breaks
  differ from PowerPoint's. The render says so, and the skill tells the agent to leave room rather
  than trust a render that only just fits.
- **Autofit.** Templates often set "shrink text on overflow". LibreOffice does not apply it to
  text written without a font scale, so it may report overflow that PowerPoint would shrink away.
  It is still a slide with too much on it; the skill treats it as a defect.
- **Not verified in real PowerPoint in this change.** No Windows machine with Office was available.
  The COM calls follow Microsoft's documented object model (checked constants: `ppSaveAsPDF = 32`,
  MsoTriState `-1`/`0`, the `Visible` refusal) and the invocation is asserted in tests, but
  opening a generated deck in PowerPoint and rendering through COM remain to be observed on
  Windows — tracked in tasks.md. ONLYOFFICE rendering was tested by the project owner.
- **What is not written:** speaker notes, animations, and chart types beyond column, bar, line and
  pie. The skill says so and tells the agent to report the gap rather than fake it.
