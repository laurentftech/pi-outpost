# Tasks

## 1. The `@pi-outpost/office` package

- [x] 1.1 Create `office/` as a workspace and move the builders into it with `git mv` (the list is in
  `proposal.md`). `server/src` imports them from `@pi-outpost/office`; the Dockerfiles and the
  standalone build follow. Verify: `npm test --workspace server`, the document tools' tests unchanged
  and green, `npm run build` and the standalone build.
- [x] 1.2 Generate a default Word template in code, as `defaultTemplate.ts` does for PowerPoint.
  Verify in `office/test`: `describeWordTemplate` lists `Title`, `Heading 1`–`Heading 3`, a bullet list
  and a table style; `createDocument` from it, with headings, a list and a table, opens in LibreOffice
  (`soffice --convert-to pdf` where present, skipped with the reason otherwise).
  Done in `office/test/wordDocument.test.ts`. No LibreOffice on the development machine: the
  document was opened in macOS Quick Look instead, and is opened in desktop Word in 5.3.

## 2. Diagrams in the builders' inputs

- [x] 2.1 A `renderDiagram` for Word: recognise a structured-exchange `json` fence, judge it with
  `judgeStructure`, draw a figure with `figureForEnvelope` + `serializeFigure` + `rasterizeSvg`, and turn
  a table into its Markdown export. A refusal throws an error naming the diagram's position and title.
  Verify: `AGraphBecomesAPictureInWord`, `ATableDocumentBecomesANativeTable` (Word),
  `OrdinaryJsonStaysCode`, `ARefusedDiagramRefusesTheDocument`.
- [x] 2.2 A slide `diagram` for PowerPoint: the same judge; a figure becomes the slide's SVG picture, a
  table its native table. Verify: `ASequenceBecomesASlidePicture`, `ATableDocumentBecomesANativeTable`
  (PowerPoint).
- [x] 2.3 **Mermaid spike, first.** Move the design session's spike into `scripts/probes/`
  (`mermaid-node.mts`): mermaid 12 in Node over jsdom, `getBBox` from `@napi-rs/canvas` `measureText`,
  `htmlLabels: false`, `look: "classic"`. Render flowchart, sequence, gantt, pie and class diagrams to
  SVG, and check each in headless Chrome (`--screenshot`). Gate: every kind renders with its nodes,
  labels and edges in place; a failure stops the Mermaid part and returns to the user (the design says
  so). Then, if it passes: `renderMermaid(source, id)` in `office/` returning `{ svg, png, width,
  height }`, the same shape as `DiagramImage`. A parse error throws with Mermaid's message. Verify:
  `MermaidDiagramIsDrawnInWord`, `MermaidDiagramIsDrawnOnASlide`, `AnInvalidMermaidRefusesTheCall`.
- [x] 2.4 Pictures: a `data:` URI in Markdown, read through the builder's `loadImage`; an `image` field
  on a slide. Decode with `imageInfo`, refuse SVG and any mismatch between MIME type and bytes, and
  refuse a picture over `OUTPOST_MAX_IMAGE_BYTES`, and refuse a URL without fetching it. Verify:
  `ADataUriPictureIsEmbedded`, `AnUnsupportedPictureIsRefused`, `AURLPictureIsNotFetched` (a fake
  HTTP server records zero requests).

## 3. The Open WebUI routes

- [x] 3.1 `OUTPOST_TEMPLATES_DIR`, `OUTPOST_MAX_FILE_BYTES` and `OUTPOST_MAX_IMAGE_BYTES` in `config.ts`;
  template lookup by name.
  `list_templates`. Verify: `TemplatesAreListed`, `APathIsNotATemplateName`,
  `AWordTemplateIsRefusedForADeck`.
- [x] 3.2 `create_document` and `create_presentation`, returning the `download` embed or a 4xx the
  model reads; their OpenAPI descriptions, with one example each that includes a diagram, a Mermaid
  fence and a picture, run by the tests. Verify: `AReportIsCreatedWithTheDefaultTemplate`,
  `ADeckIsCreatedWithTheDefaultTemplate`, `AnAdministratorTemplateIsUsed`, `ATooLargeResultIsRefused`,
  `AnUnsignedCallIsRefused`.

## 4. The viewer's `download` mode

- [x] 4.1 Show the file's name, size, outline and figures, and a download button. Verify in
  `e2e/openwebui-embed.spec.ts`, in Open WebUI's sandbox: `TheDownloadIsTheDocument` (bytes compared),
  and the embed survives Open WebUI's storage (`survivesOpenWebUIStorage`).

## 5. Image, docs, live run

- [x] 5.1 Bundle `@pi-outpost/office`; add `@napi-rs/canvas`, `mermaid` 12, `jsdom` and
  `fonts-dejavu-core`; record the image size before and after in `design.md`, with and without the
  Mermaid dependencies, so their cost is visible. Verify: `npm run test:image` creates a document with a
  structured-exchange diagram, a Mermaid diagram and a picture; each PNG fallback is not blank.
- [x] 5.2 `docs/openwebui.md` (what users can ask, configuration, limits),
  `docs/openwebui-architecture.md`, `openwebui/deploy/.env.example`, the compose file's templates volume.
- [ ] 5.3 Live run in Open WebUI with a real model (Codestral): a report with a graph, a table, a Mermaid
  flowchart and a picture; a deck with a sequence, a chart and a Mermaid slide; open both files in Word
  or LibreOffice and look at the diagrams. Record it in `live-run.md`.
- [x] 5.4 `scenario-coverage.md`, `npm run check:scenarios`, `openspec validate --strict`.
