# Tasks

## 1. The `@pi-outpost/office` package

- [ ] 1.1 Create `office/` as a workspace and move the builders into it with `git mv` (the list is in
  `proposal.md`). `server/src` imports them from `@pi-outpost/office`; the Dockerfiles and the
  standalone build follow. Verify: `npm test --workspace server`, the document tools' tests unchanged
  and green, `npm run build` and the standalone build.
- [ ] 1.2 Generate a default Word template in code, as `defaultTemplate.ts` does for PowerPoint.
  Verify in `office/test`: `describeWordTemplate` lists `Title`, `Heading 1`–`Heading 3`, a bullet list
  and a table style; `createDocument` from it, with headings, a list and a table, opens in LibreOffice
  (`soffice --convert-to pdf` where present, skipped with the reason otherwise).

## 2. Diagrams in the builders' inputs

- [ ] 2.1 A `renderDiagram` for Word: recognise a structured-exchange `json` fence, judge it with
  `judgeStructure`, draw a figure with `figureForEnvelope` + `serializeFigure` + `rasterizeSvg`, and turn
  a table into its Markdown export. A refusal throws an error naming the diagram's position and title.
  Verify: `AGraphBecomesAPictureInWord`, `ATableDocumentBecomesANativeTable` (Word),
  `OrdinaryJsonStaysCode`, `ARefusedDiagramRefusesTheDocument`.
- [ ] 2.2 A slide `diagram` for PowerPoint: the same judge; a figure becomes the slide's SVG picture, a
  table its native table. Verify: `ASequenceBecomesASlidePicture`, `ATableDocumentBecomesANativeTable`
  (PowerPoint).

## 3. The Open WebUI routes

- [ ] 3.1 `OUTPOST_TEMPLATES_DIR` and `OUTPOST_MAX_FILE_BYTES` in `config.ts`; template lookup by name.
  `list_templates`. Verify: `TemplatesAreListed`, `APathIsNotATemplateName`,
  `AWordTemplateIsRefusedForADeck`.
- [ ] 3.2 `create_document` and `create_presentation`, returning the `download` embed or a 4xx the
  model reads; their OpenAPI descriptions, with one example each that includes a diagram, run by the
  tests. Verify: `AReportIsCreatedWithTheDefaultTemplate`, `ADeckIsCreatedWithTheDefaultTemplate`,
  `AnAdministratorTemplateIsUsed`, `ATooLargeResultIsRefused`, `AnUnsignedCallIsRefused`.

## 4. The viewer's `download` mode

- [ ] 4.1 Show the file's name, size, outline and figures, and a download button. Verify in
  `e2e/openwebui-embed.spec.ts`, in Open WebUI's sandbox: `TheDownloadIsTheDocument` (bytes compared),
  and the embed survives Open WebUI's storage (`survivesOpenWebUIStorage`).

## 5. Image, docs, live run

- [ ] 5.1 Bundle `@pi-outpost/office`; add `@napi-rs/canvas` and `fonts-dejavu-core`; record the image
  size before and after in `design.md`. Verify: `npm run test:image` creates a document with a diagram
  in the image and its PNG fallback is not blank.
- [ ] 5.2 `docs/openwebui.md` (what users can ask, configuration, limits),
  `docs/openwebui-architecture.md`, `openwebui/deploy/.env.example`, the compose file's templates volume.
- [ ] 5.3 Live run in Open WebUI with a real model (Codestral): a report with a graph and a table, a deck
  with a sequence and a chart; open both files in Word or LibreOffice. Record it in `live-run.md`.
- [ ] 5.4 `scenario-coverage.md`, `npm run check:scenarios`, `openspec validate --strict`.
