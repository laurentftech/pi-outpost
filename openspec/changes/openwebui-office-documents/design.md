# Design

## Context

- **pi-outpost's builders** are pure functions over bytes:
  - Word: `createDocument(readWordPackage(template), markdown, { keep, pictures })` (`docxBuild.ts`).
    `pictures.renderDiagram(source, id)` turns a fence into a `DiagramImage` (`{ svg, png, width,
    height }`); without it a fence stays its source. pi-outpost's server passes none today, which is why
    `docx_create` says Mermaid is written as source.
  - PowerPoint: `buildPresentation(readTemplate(template), slides, { rasterizeSvg })` (`pptxBuild.ts`).
    An SVG picture is written with the 2016 SVG extension and a PNG beside it.
  - Default PowerPoint template: generated in code (`defaultTemplate.ts`). No Word default exists.
  - Their only Node dependency is `node:zlib`; Word also uses the `docx` package.
- **Figures without a browser:** `figureForDocument(text, checkSchema, narrowing, limits)` validates and
  draws a graph, sequence or timeline; `serializeFigure` makes the SVG. A table has no figure; its
  Markdown export exists (`structuredExchangeTableExport.ts`). This is what `structure_figure` uses.
- **Raster:** `rasterizeSvg` draws through `@napi-rs/canvas`, an optional native package. Without it,
  the PNG is a transparent pixel.
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

**Non-Goals:** updating uploaded documents, visual page checks, Mermaid, pictures, stored files (see the
proposal).

## Decisions

### The file travels inside the embed

- **Choice:** the answer is the viewer in a `download` mode. The payload carries the file
  (gzip + base64, as the other embeds), its name, its outline and its figures' titles. The viewer offers
  a download button, which builds a `Blob` and clicks a link. `allow-downloads` is already in Open
  WebUI's sandbox, and the table's XLSX download already works this way.
- **Rationale:** the tool server publishes no port, so the browser cannot fetch a stored file from it.
  Stateless, like `show_structure`: nothing to store, expire, or authorise again.
- **Cost:** the file lives in the chat's database. A limit `OUTPOST_MAX_FILE_BYTES` (default 5 MB, the
  file before compression) refuses larger results with a message for the model. Without pictures,
  documents are small: text, XML and SVG compress well.
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
  in a pi-outpost reply (`structuredExchangeReplyBlocks.ts`). `renderDiagram` validates it with the
  same gate as `show_structure` (`judgeStructure`), then:
  - a graph, sequence or timeline is drawn with `figureForEnvelope` → `serializeFigure`, and rasterised;
  - a table is written as its Markdown export, so it becomes a Word table in the template's style.
- **PowerPoint:** a slide's `diagram` field takes the same document (object or JSON string). A figure
  becomes the slide's picture; a table becomes the slide's native table.
- **A refusal refuses the call**, naming the diagram (its position, and its title when it has one) with
  the gate's issues and the guide topic, like `show_structure`'s. A JSON fence that is not a
  structured-exchange document stays code.
- **Timelines** are drawn at today's date, as `show_structure` draws them.

### Raster: `@napi-rs/canvas` and one font in the image

Word 2016+ and PowerPoint 2016+ draw the SVG. LibreOffice, Google Docs and older Office show the PNG.
A transparent pixel would leave them a blank space, so the image installs `@napi-rs/canvas` (its only
runtime `node_modules`) and a font family (`fonts-dejavu-core`) so the raster has text. The image size
is measured before and after. If canvas fails to load, the call is refused, not written with blank
pictures.

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
create_presentation { file_name, slides: [{ layout?, title?, subtitle?, bullets?, table?, chart?, diagram? }], template? }
list_templates      { }
```

`file_name` is a name, without a folder; its extension is added or checked. The slide fields are
`pptx_create`'s, minus `image`, plus `diagram`.

## Risks / Trade-offs

- **Chat size** → the size limit; pictures are out of scope.
- **Image size** (canvas, fonts) → measured. If it is unreasonable, the fallback is an optional raster
  with a documented blank fallback; decided on the numbers.
- **The refactor touches pi-outpost's document tools** → moved, not rewritten; every existing test runs
  unchanged.
- **Weak models and long Markdown with JSON fences** → examples in the description, tested; the
  refusal names the diagram to fix.
