# Design

## Context

- **pi-outpost's builders** are pure functions over bytes:
  - Word: `createDocument(readWordPackage(template), markdown, { keep, pictures })` (`docxBuild.ts`).
    `pictures.renderDiagram(source, id)` turns a **Mermaid** fence (and only a Mermaid fence) into a
    `DiagramImage` (`{ svg, png, width, height }`); without it, or when it throws, the fence silently
    stays its source. `pictures.imageKey`/`loadImage` resolve `![alt](src)` references the same way:
    a picture that does not load becomes its alt text, with a warning. pi-outpost's server passes no
    `renderDiagram` today, which is why `docx_create` says Mermaid is written as source.
  - PowerPoint: `buildPresentation(readTemplate(template), slides, { rasterizeSvg })` (`pptxBuild.ts`).
    An SVG picture is written with the 2016 SVG extension and a PNG beside it.
  - Default PowerPoint template: generated in code (`defaultTemplate.ts`). No Word default exists.
  - Their only Node dependency is `node:zlib`; Word also uses the `docx` package.
- **Figures without a browser:** `figureForDocument(text, checkSchema, narrowing, limits)` validates and
  draws a graph, sequence or timeline; `serializeFigure` makes the SVG. A table has no figure; its
  Markdown export exists (`structuredExchangeTableExport.ts`). This is what `structure_figure` uses.
- **Raster:** pi-outpost's `rasterizeSvg` draws through `@napi-rs/canvas`, an optional native package.
  Without it, the PNG is a transparent pixel. A canvas draw ignores SVG markers and
  `dominant-baseline` (Mermaid lost its arrowheads and its labels rose), so this change draws its
  rasters with resvg (`office/src/svgRaster.ts`).
- **Structured-exchange figures** are self-styled SVG with their own size: no stylesheet, no classes.
  Mermaid's are not: a `<style>` block and class selectors, which LibreOffice does not apply inside
  the SVG extension (the viewer's export resolves them with the browser's computed style).
- **Open WebUI v0.11.4** embeds an inline HTML tool answer in an iframe with `sandbox="allow-scripts
  allow-popups allow-downloads"`, and gives the model only "Embedded UI result is active", never the
  answer's content. A 4xx answer's JSON does reach the model.
- **The Open WebUI image** ships one bundled `server.mjs`, the viewer and the guide, with no
  `node_modules`.

## Goals / Non-Goals

**Goals:**
- A Word report or a PowerPoint deck from one tool call, in a template, with structured-exchange
  diagrams drawn exactly as `show_structure` draws them.
- No second builder: pi-outpost's code, moved, not copied.
- A model that gets a document wrong is told why, in the same turn.

**Non-Goals:** updating uploaded documents, visual page checks, pictures the server must fetch, stored
files (see the proposal).

## Decisions

### The file travels inside the embed

- **Choice:** the answer is the viewer in a `download` mode. The payload carries the file
  (gzip + base64, as the other embeds), its name, its outline and its figures' titles. The viewer offers
  a download button, which builds a `Blob` and clicks a link. `allow-downloads` is already in Open
  WebUI's sandbox, and the table's XLSX download already works this way.
- **Rationale:** the tool server publishes no port, so the browser cannot fetch a stored file from it.
  Stateless, like `show_structure`: nothing to store, expire, or authorise again.
- **Cost:** the file lives in the chat's database. A limit `OUTPOST_MAX_FILE_BYTES` (default 5 MB, the
  file before compression) refuses larger results with a message for the model. Pictures and Mermaid
  figures add their PNG and SVG to that size; text, XML and SVG compress well, PNG does not, so the limit
  is what keeps a chat's database bounded.
- **Rejected:** storing files and serving a download route. It needs a route reachable from users'
  browsers, which the deployment deliberately does not have.
- **Rejected:** uploading to Open WebUI's file store. It needs the user's Open WebUI token, which the
  tool server never receives.

### Nothing the model must know goes only in the embed

The model never reads the embed. So the builders' warnings are either promoted to refusals (a refused
diagram, a template that is not one, an unknown layout) or dropped where they are harmless. The 200
answer means the whole document was written as asked.

### Diagrams: the `show_structure` gate, then the figure

- **Word:** a ` ```json ` fence whose content declares the structured-exchange schema is a diagram, as
  in a pi-outpost reply. The Word mapping only hands Mermaid fences to `renderDiagram`, so these are
  handled before it: `structuredExchangeBlockRanges` (added beside `structuredExchangeBlocks`, which now
  uses it) finds each block and its lines; each is judged with `judgeStructure`, then replaced in the
  Markdown:
  - a graph, sequence or timeline by a picture reference (`![title](sx-figure:N)`) that the picture
    source answers with the figure `figureForEnvelope` draws and its raster;
  - a table by its Markdown export (`tableMarkdown`), so it becomes a Word table in the template's style.
- **Every failure the mapping would hide is recorded.** `callPictures` (`office/src/callPictures.ts`)
  is the picture source for a call: it answers figure references, decodes `data:` URIs, draws Mermaid
  fences, and records each picture or Mermaid fence it could not produce with its position. The route
  refuses the call with them after the build, since the mapping goes on writing the alt text or the
  source.
- **PowerPoint:** a slide's `diagram` field takes the same document (object or JSON string). A figure
  becomes the slide's picture; a table becomes the slide's native table.
- **A refusal refuses the call**, naming the diagram (its position, and its title when it has one) with
  the gate's issues and the guide topic, like `show_structure`'s. A JSON fence that is not a
  structured-exchange document stays code.
- **Timelines** are drawn at today's date, as `show_structure` draws them.

### Mermaid: rendered in Node, gated by a spike

- **Choice:** option 2 of the three considered. `mermaid` 12 (the version the UI uses) runs in Node
  against a `jsdom` window, **in a worker thread** (`office/src/mermaidWorker.ts`): the shim installs
  `window`, `document` and the DOM classes as globals, which in the server's thread would make every
  library that tests `typeof window` think it runs in a browser. The worker also gives a timeout that
  can stop a diagram that does not finish, and one diagram is drawn at a time (Mermaid is global).
  Mermaid needs a DOM and text measurement; the shim gives it both:
  - text is measured line by line (each `tspan` placed by its `y`/`dy`, centred by `text-anchor`) with
    `measureText` in `@napi-rs/canvas` and the font's own ascent and descent;
  - `getBBox` of a shape comes from its geometry (`points`, `d`, `r`…), of a group from its children
    moved by their `translate`; `getBoundingClientRect` returns the same box (the pie chart sizes its
    legend with it);
  - the viewer's export settings: `theme: "default"`, `look: "classic"`, `htmlLabels: false`; a gantt
    chart gets a fixed width (`useWidth`), since a jsdom container is 0 wide.
  The SVG that goes into the file has its styles written onto each element (an inliner that applies
  Mermaid's CSS rules by specificity, since jsdom computes no cascade), as the viewer's export does;
  the raster is drawn by resvg from the styled original. `svgDimensions`' parsing and
  `withExplicitSize` moved to `shared/src/docx/svgSize.ts`, shared by the viewer's export and this
  renderer.
- **Spike (before any other task):** `scripts/probes/mermaid-node.mts` renders flowchart, sequence,
  gantt, pie and class diagrams through the renderer, and draws each vector in headless Chrome. The
  first spike (a constant `getBBox`) gave offset edge labels and overflowing multi-line nodes; with the
  measurement above, all five kinds draw with their nodes, labels, edges and legends in place, and the
  raster matches the vector. **The gate passed in Chrome.** The user's target is desktop Word; the
  check in Word is task 5.3. The acceptance bar for merge is the set of diagram kinds
  above, rendered without the shim's gaps visible in the output. Failing it, this part is reconsidered
  with the user, not silently replaced with source.
- **Rejected:** Chromium in the image. Hundreds of MB for one feature, the size this change measures.
- **Rejected:** the Mermaid fence kept as source, with a steer to a structured-exchange diagram. It is
  the current behaviour and the reason this part was asked for.
- **Determinism:** the picture is what Mermaid draws for the source at the time of the call. Tests
  compare the rendered SVG to a fresh render of the same source, not to bytes stored in a fixture.

### Pictures: data URIs in the call

- **Choice:** the picture's bytes travel in the call. In Markdown, `![alt](data:image/png;base64,…)`,
  which Word's builder already reads through its `loadImage` hook; on a slide, an `image` field
  (`{ data, alt? }`), as `pptx_create` takes one.
- **Limits:** `OUTPOST_MAX_IMAGE_BYTES` (default 1 MB per picture, after decoding). PNG, JPEG and GIF
  only; an SVG picture is refused rather than guessed at. A picture that does not decode, or a MIME type
  that does not match its bytes, refuses the call with the picture's position.
- **Rationale:** the server fetches nothing, so there is no allowlist to maintain and no request forged
  from the model's input. The cost is tokens: the model must emit the base64. The limit bounds it.
- **Rejected:** URLs fetched by the server (SSRF surface, needs an allowlist of hosts).
- **Rejected:** the chat's uploaded files: the tool server never sees them.

### Raster: resvg and one font in the image

Word 2016+ and PowerPoint 2016+ draw the SVG; desktop Word is the target that matters, the rest is
best effort. LibreOffice, Google Docs and older Office show the PNG. A transparent pixel would leave
them a blank space, so the image installs `@resvg/resvg-js` (rasters), `@napi-rs/canvas` (Mermaid's
text measurement) and a font family (`fonts-dejavu-core`), the same face for measuring and drawing.
A raster that cannot be drawn refuses the call rather than writing a blank picture — including one
whose text would be missing: resvg finds a Linux system's fonts through fontconfig's configuration,
which the slim image does not have, so every label vanished from the PNG while shapes and arrows
stayed. The font directories are passed explicitly, and a probe word is drawn once per font before
any raster.

**Measured** (`docker images`, both built from the same Dockerfile shape on 2026-10-11):

| Image | Size |
|---|---|
| `main` before this change | 232 MB |
| with the document tools | 312 MB (+80 MB) |

The runtime `node_modules` is 42 packages; the largest part is `@napi-rs/canvas`'s native binary
(~31 MB), used only to measure Mermaid's text. The worker bundle (Mermaid and its dependencies) is
12.8 MB. If the size matters later, the measurement can move to resvg (`getBBox` of a one-word SVG)
and canvas leave the image.

### Templates by name, from one folder

- No `template`: the built-in default for the format.
- `template: "acme-report.dotx"`: a file directly in `OUTPOST_TEMPLATES_DIR`, read-only, matched by
  name among the folder's entries. A path, a `..`, a subfolder or an unknown name is refused, with the
  list of names.
- `list_templates` returns each template's name, format, and what it offers: for Word,
  `describeWordTemplate` (styles, cover page, table of contents); for PowerPoint, `describeTemplate`
  (layouts and their placeholders).
- Templates are shared by every user. Personal templates would need uploads, which the tool server
  never sees.

### The builders move to `@pi-outpost/office`

- **Choice:** a new workspace package, `office/`, holding the builders and their helpers.
  `server/src` imports from it; files move with `git mv` and the server's tests keep running against
  the server's tools.
- **Rejected:** importing `server/src/*` from `openwebui/`. The server package is not a library, and
  its imports pull in pi.
- **Rejected:** putting them in `apps-core`. It holds what the app servers share about the contract;
  the builders are a separate, heavier concern, and `mcp/` does not need them.

### A default Word template, generated

As for PowerPoint, for the same reasons (`defaultTemplate.ts`): built in code, Office's theme, styles
named in English (`Heading 1`…, `Title`, `List Bullet`, `Table Grid`), A4 portrait. pi-outpost's
`docx_create` keeps requiring a template; making it optional there is a separate change.

### Tool shapes

```
create_document     { file_name, markdown, template?, keep? }
create_presentation { file_name, slides: [{ layout?, title?, subtitle?, bullets?, table?, chart?, diagram?, mermaid?, image? }], template? }
list_templates      { }
```

`file_name` is a name, without a folder; its extension is added or checked. The slide fields are
`pptx_create`'s, plus `diagram` and `mermaid` (source text). `image` is `{ data, alt? }`, with `data` a
`data:` URI as above.

## Risks / Trade-offs

- **Chat size** → the size limit; pictures and Mermaid PNGs count toward it.
- **Mermaid fidelity** → the spike is the gate; the classic look with the shim's measurements is not
  pixel-identical to the UI export, and the spec says so rather than promising it.
- **Image size** (canvas, fonts, mermaid, jsdom) → measured. If it is unreasonable, the fallback is an
  optional raster with a documented blank fallback; decided on the numbers.
- **Token cost of base64 pictures** → `OUTPOST_MAX_IMAGE_BYTES`; the description tells the model to
  prefer diagrams it can write as source.
- **The refactor touches pi-outpost's document tools** → moved, not rewritten; every existing test runs
  unchanged.
- **Weak models and long Markdown with JSON fences** → examples in the description, tested; the
  refusal names the diagram to fix.
