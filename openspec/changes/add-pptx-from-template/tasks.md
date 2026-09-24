## 1. Establish the formats and the programs before writing them

- [x] 1.1 Read a PowerPoint-authored template (python-pptx's `default.pptx`) part by part: layout
  placeholders with and without a transform, the master's body placeholder they inherit from, the
  `sldLayoutIdLst` order, and a presentation part with no `sldIdLst` at all.
- [x] 1.2 Confirm the SVG picture extension (`asvg:svgBlip` under URI
  `{96DAC541-7B7A-43D3-8B79-37D633B846F1}`, PNG as the blip itself).
- [x] 1.3 Confirm the PowerPoint object model: `Presentations.Open(FileName, ReadOnly, Untitled,
  WithWindow)` with MsoTriState values, `ppSaveAsPDF = 32`, and that `Application.Visible = False`
  is refused ("Hiding the application window is not allowed").
- [x] 1.4 Read the ONLYOFFICE Document Builder CLI documentation (from its repository): script
  files run as `docbuilder <script>`, `builder.OpenFile(path, params)`, `builder.SaveFile("pdf",
  path)`, `builder.CloseFile()`, install paths on Windows and Linux.
- [x] 1.5 Read Anthropic's public `pptx` skill in full, and take its structure (task table, template
  rules, mandatory render-and-fix QA, font-substitution caveat) without copying its text, which is
  not MIT-licensed.
- [x] 1.6 Establish on a real LibreOffice rendering that text past a slide's bottom edge is absent
  from the PDF's text layer — the basis of the text check.

## 2. Writing a deck

- [x] 2.1 `zipWriter.ts` (deterministic, UTF-8 names, no ZIP64), and `readAllZipEntries` in
  `zip.ts` with a total expanded-size budget.
- [x] 2.2 `imageInfo.ts`: PNG, JPEG, GIF and SVG kind and size from the bytes; refuse SVGs that
  reach outside themselves or declare a DOCTYPE.
- [x] 2.3 `pptxBuild.ts`: read layouts and placeholder boxes (master inheritance), choose layouts,
  write placeholder shapes, bullets, bold, pictures (fit, SVG + fallback), sweep the template's
  slides by reachability, rewrite the presentation part, its relationships and content types.

## 3. Rendering a deck

- [x] 3.1 `presentationRender.ts`: PowerPoint (PowerShell/COM), LibreOffice and ONLYOFFICE
  converters on a private copy; `auto` order; executables from configuration or conventional
  locations; timeouts; the turn's abort signal terminates the converter and starts no other.
- [x] 3.2 Rasterise PDF pages with pdf.js and `@napi-rs/canvas`; SVG fallbacks with the same canvas,
  bytes only.
- [x] 3.3 The text check: each slide's paragraphs (`readSlideParagraphs` in `pptx.ts`) against the
  page's text layer.

## 4. Tools, skill, wiring

- [x] 4.1 `presentationTools.ts`: `pptx_layouts`, `pptx_create`, `pptx_render`, every path argument
  confined to its zone.
- [x] 4.2 Register them in the sandboxed toolset (`pptx_create` only where writing is), the
  unsandboxed toolset and the RPC child; pass the render settings through all three.
- [x] 4.3 Publish them on demand (`documentTools.ts`, `index.ts`): `.potx`/`.pptx` in a prompt,
  `/skill:pptx-from-template`, the agent reading the skill or naming a template path — never
  republishing an extractor from the agent's side (design §6).
- [x] 4.4 `pptx.renderer`, `pptx.libreofficePath`, `pptx.onlyofficePath`, `pptx.renderTimeoutMs`.
- [x] 4.5 `skills/pptx-from-template/SKILL.md`, listed in `skills/README.md`.

## 5. Proving it

- [x] 5.1 Unit tests: `zipWriter.test.ts`, `imageInfo.test.ts`, `pptxBuild.test.ts`,
  `presentationRender.test.ts`, `presentationTools.test.ts`, and the updated `documentTools`,
  `sandbox-tools`, `piOutpostTools`, `config` and `bundledSkill` tests.
- [x] 5.2 Fixtures written by script: `make-pptx-template.mjs` (the template) and
  `make-pptx-rendered.mts` (a deck and its real LibreOffice PDF).
- [x] 5.3 Over the running server with a scripted model (`presentationToolsWire.test.mjs`):
  publication on a named template and on reading the skill, and the full layouts → create → render
  loop, run here against real LibreOffice 24.2 — the render returned two slide pictures and a clean
  text check.
- [x] 5.4 Look at the rendered slides: title, bullets with levels and bold, an SVG beside text, and
  an overflowing slide whose clipped paragraphs the text check names.
- [x] 5.5 Scenario matrix (`scenario-coverage.md`) and `npm run check:scenarios`.
- [x] 5.6 In the running app, in Chromium through Playwright, with the scripted model: the three tool
  cards appear and expand to the full results, `deck.pptx` lands in the workspace, the render
  reports LibreOffice and a clean text check. Then trying to break it: rebuilding onto an existing
  deck (refused, visibly), a double send, the template deleted underneath (`No such file`), a new
  session opened mid-build (no stale cards), the workspace deleted underneath (clean refusal, server
  healthy); no page error in any of them. That pass found the tools ignoring the turn's abort
  signal — a stopped turn would have left an office application converting for up to two
  minutes — now fixed and covered (`StoppingTheTurnStopsTheRendering`).
- [x] 5.7 Found, not fixed here: the interface shows a tool result's pictures as `[image]`
  (`convert.ts` `contentText`), for every tool. The model sees the slides; the person watching does
  not. `pdf_path` gives them the rendering to open in the PDF viewer meanwhile. Proposed as a
  separate change.

## 6. Tables and charts

- [x] 6.1 Read python-pptx's chart writer and graphic-frame and table templates for the element
  orders, the default table style GUID, the chart and package relationship types and the
  `c:externalData` link.
- [x] 6.2 `pptxVisuals.ts`: native tables (style, header, figure alignment, size by rows) and
  charts (column, bar, line, pie; stacked; number format; value labels; theme accents) with an
  embedded workbook; validation with readable limits.
- [x] 6.3 Place them like a picture (never in a picture placeholder), one visual per slide; chart
  and workbook names that avoid the template's parts; content types.
- [x] 6.4 Tool parameters `table` and `chart`; skill section on choosing and checking them.
- [x] 6.5 Render every chart type and a table through LibreOffice and look at them; run the decks
  through an OOXML schema and PowerPoint-constraint validator; read the workbooks back.
- [x] 6.6 Tests: `pptxVisuals.test.ts`, and table/chart cases in `pptxBuild.test.ts` and
  `presentationTools.test.ts`.

## 7. Still to observe on Windows

- [ ] 7.1 Open a deck made from a real corporate `.potx` in PowerPoint for Microsoft 365: no repair
  prompt, placeholders styled by the template, SVG drawn as vector, tables in the template's style,
  charts in its colours and *Edit Data* opening the embedded workbook.
- [ ] 7.2 Render through PowerPoint COM from a pi-outpost server on Windows (interactive session and
  as a service account), and confirm PowerPoint stays open when the user had a deck open in it.
- [x] 7.3 Render with ONLYOFFICE Document Builder — tested by the project owner.
