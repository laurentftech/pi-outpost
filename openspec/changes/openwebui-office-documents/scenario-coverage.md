# Scenario coverage — openwebui-office-documents

Two capabilities: `openwebui-office-documents` (7 added requirements, 20 scenarios) and the modified
`openwebui-planning-server` requirement `ToolsAreDescribedForOpenWebUI` (4 scenarios). Evidence:

- **Server, through its routes:** `openwebui/test/documents.test.ts` calls the tools as Open WebUI does
  (`app.inject` with the bearer key and a signed user), inflates the embed the way the viewer does,
  and opens the `.docx`/`.pptx` with the builders' own zip reader. Mermaid is drawn by the real
  renderer (worker, jsdom, canvas, resvg), not a fake.
- **The builders and the renderer:** `office/test/wordDocument.test.ts` and
  `office/test/mermaidRender.test.ts`.
- **In Open WebUI's sandbox:** `e2e/openwebui-embed.spec.ts`, the page framed exactly as Open WebUI
  v0.11.4 frames a tool's embed.
- **In the image:** `openwebui/test/image.sh` ("ADocumentIsWrittenInTheImage") writes a document
  with a structured-exchange graph, a Mermaid diagram and a picture inside the container, and checks
  every PNG fallback is drawn.

## openwebui-office-documents

| Scenario | Coverage | Evidence |
| --- | --- | --- |
| AReportIsCreatedWithTheDefaultTemplate | covered | `openwebui/test/documents.test.ts` — "AReportIsCreatedWithTheDefaultTemplate: headings, list and table in the default styles, nothing stored": `Heading1`/`Heading2` paragraph styles on the Markdown's headings, a numbered list, a table, the default template's `styles.xml`, the file named `report.docx`, and no file under the data directory. |
| TheDownloadIsTheDocument | covered | `e2e/openwebui-embed.spec.ts` — "TheDownloadIsTheDocument: the button inside Open WebUI's sandbox hands over the document the server built": the page comes from the server's own `create_document` answer, framed with `allow-scripts allow-popups allow-downloads`; the browser's download is named after the file and its bytes equal the document's. |
| ADeckIsCreatedWithTheDefaultTemplate | covered | `openwebui/test/documents.test.ts` — "ADeckIsCreatedWithTheDefaultTemplate: four slides in order, with their content": slides 1–4 hold the title and subtitle, the bullets, a native `a:tbl` and a native chart, and there is no fifth slide. |
| AGraphBecomesAPictureInWord | covered | `openwebui/test/documents.test.ts` — "AGraphBecomesAPictureInWord: the figure show_structure draws, with a PNG behind it": the SVG part equals `figureForEnvelope(judgeStructure(graph))` byte for byte, the PNG is not empty, the picture sits between the paragraphs around the fence, and the JSON is not written as code. |
| ASequenceBecomesASlidePicture | covered | `openwebui/test/documents.test.ts` — "ASequenceBecomesASlidePicture: the sequence's figure, with a PNG fallback": the slide's SVG equals the sequence's figure, with one PNG and the `svgBlip` extension on the slide. |
| ATableDocumentBecomesANativeTable | covered | `openwebui/test/documents.test.ts` — "ATableDocumentBecomesANativeTable (Word)" and "(PowerPoint)": each file holds a native table with every column and cell of the document, and no media part at all. |
| OrdinaryJsonStaysCode | covered | `openwebui/test/documents.test.ts` — "OrdinaryJsonStaysCode": the JSON's text is in a run of the monospace face code blocks are written in, and no picture is made. |
| MermaidDiagramIsDrawnInWord | covered | `openwebui/test/documents.test.ts` — "MermaidDiagramIsDrawnInWord": one SVG and one non-empty PNG, between the surrounding paragraphs, the SVG equal to a fresh render of the source but for the render id. Also `office/test/wordDocument.test.ts` — the same at the builder, with no refusal recorded. |
| MermaidDiagramIsDrawnOnASlide | covered | `openwebui/test/documents.test.ts` — "MermaidDiagramIsDrawnOnASlide": an SVG and a non-empty PNG on the slide; the SVG's text holds both messages of the sequence. |
| AnInvalidMermaidRefusesTheCall | covered | `openwebui/test/documents.test.ts` — "AnInvalidMermaidRefusesTheCall": 422, no embed, one refusal at position 2 carrying Mermaid's parse error. `office/test/mermaidRender.test.ts` — the renderer refuses with Mermaid's message and draws the next diagram afterwards. |
| ADataUriPictureIsEmbedded | covered | `openwebui/test/documents.test.ts` — "ADataUriPictureIsEmbedded": the one media part equals the PNG given, byte for byte, and the picture carries its alt text. |
| AnUnsupportedPictureIsRefused | covered | `openwebui/test/documents.test.ts` — "AnUnsupportedPictureIsRefused (Word)": an SVG and a PNG declared `image/jpeg` refuse the call, each named by position and reason; "(PowerPoint)": an SVG slide image refuses the deck, a PNG one is embedded as given. `office/test/wordDocument.test.ts` adds bad base64, missing `;base64` and the size limit. |
| AURLPictureIsNotFetched | covered | `openwebui/test/documents.test.ts` — "AURLPictureIsNotFetched": a picture pointing at a local HTTP server refuses the call, naming the picture and asking for a data: URI, and the server records zero requests. |
| ARefusedDiagramRefusesTheDocument | covered | `openwebui/test/documents.test.ts` — "ARefusedDiagramRefusesTheDocument": with a valid first diagram and an invalid second, 422 and no embed; the refusal names position 2, its issues equal `parseSerializedStructuredExchange`'s for that document, and it names a guide topic. |
| ATooLargeResultIsRefused | covered | `openwebui/test/documents.test.ts` — "ATooLargeResultIsRefused: the limit and the size": with `maxFileBytes: 1000`, 422, no embed, `limit` 1000 and a `size` above it. |
| AnAdministratorTemplateIsUsed | covered | `openwebui/test/documents.test.ts` — "AnAdministratorTemplateIsUsed": with a French Word template in the folder, the heading is written in its `Titre1` style, and the card names the template. |
| TemplatesAreListed | covered | `openwebui/test/documents.test.ts` — "TemplatesAreListed": a `.dotx` and a `.potx` are listed with their formats (a `.txt` beside them is not), the Word one with its `heading 1` style, the PowerPoint one with its layouts. |
| APathIsNotATemplateName | covered | `openwebui/test/documents.test.ts` — "APathIsNotATemplateName": a name climbing out of the folder (`..`), names with a forward or a back slash into a subfolder, and an unknown name are each refused with exactly the folder's own names, and the content of a file placed beside the folder never appears in the answer. |
| AWordTemplateIsRefusedForADeck | covered | `openwebui/test/documents.test.ts` — "AWordTemplateIsRefusedForADeck": refused, saying it is a Word template, with the PowerPoint templates offered. |
| AnUnsignedCallIsRefused | covered | `openwebui/test/documents.test.ts` — "AnUnsignedCallIsRefused": for each of the three tools, no bearer key, no identity, and a token signed with the wrong key are all 401. |

## openwebui-planning-server

| Scenario | Coverage | Evidence |
| --- | --- | --- |
| TheDescriptionNamesTheFiveTools | covered | `openwebui/test/openapi.test.ts` — "TheDescriptionNamesTheFiveTools: exactly the operations — planning, structure and document tools, each described with an input schema": the operation ids are exactly the ten tools, each with a description and an object input schema, each path its tool's name. |
| TheCreationExampleIsValid | covered | `openwebui/test/openapi.test.ts` — "TheCreationExampleIsValid and TheUpdateExampleApplies: the examples as published" (unchanged by this change). |
| TheUpdateExampleApplies | covered | `openwebui/test/openapi.test.ts` — the same test. |
| TheDocumentExamplesAreWritten | covered | `openwebui/test/documents.test.ts` — "TheDocumentExamplesAreWritten": the published `create_document` example answers with a document holding its Mermaid diagram and its picture; the `create_presentation` example answers with one slide per slide given and its Mermaid slide drawn. |

## docx-templates

| Scenario | Coverage | Evidence |
| --- | --- | --- |
| AMermaidFenceBecomesAPicture | covered | `server/test/wordTools.test.ts` — "AMermaidFenceBecomesAPicture: docx_create draws a ```mermaid fence in its place, with nothing to report": one SVG carrying the labels and one PNG, between the paragraphs around the fence, the source not written, no note; "docx_update draws a Mermaid fence it appends, through the same pictures": the appended sequence is an SVG picture with its message and no note. The real renderer, not a fake. |
| AnUndrawableMermaidIsNamed | covered | `server/test/wordTools.test.ts` — "AnUndrawableMermaidIsNamed": the answer's note names diagram 1 with Mermaid's parse error, and the source is in the document. `server/test/docxBuild.test.ts` — "a mermaid diagram the renderer refuses is named, with its reason, and kept as its source": position 2 named, its first message line kept, the first diagram drawn. |
| WithoutARendererTheSourceStays | covered | `server/test/wordTools.test.ts` — "WithoutARendererTheSourceStays": with `mermaid: null`, the note says this installation cannot draw them and the document has no media. `server/test/docxBuild.test.ts` — "a mermaid diagram and a missing picture are reported, not silently dropped". |

## Not covered by a test here

- **Desktop Word.** The user's target. The documents open and render in Chrome (the SVGs), in the
  container (the PNGs) and in macOS Quick Look; opening them in desktop Word is task 5.3, by hand.
- **A real model.** Whether Codestral uses the tools well from their descriptions is task 5.3.
