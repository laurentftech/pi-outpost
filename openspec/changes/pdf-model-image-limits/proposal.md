## Why

Two failures on the same kind of deployment, reported as #526 and #527 against 0.63.1:

- **#526.** A model behind a gateway that limits images per request — LiteLLM in front of vLLM, `gemma-4` taking at most 4 — refused the whole turn with a 400 as soon as `pdf_render` returned its default eight pages, or `pdf_extract` with `images: "all"` its eight pictures, or a second call brought the conversation's images past the limit. The pages were lost and the user saw the proxy's error. pi already reads a model's `inputLimits.images.maxPerRequest` / `maxPerMessage` (from `models.json` or a `modelOverrides` entry) and does not act on them.
- **#527.** `pdf_extract` on a scanned document with an OCR layer ran out of its flat 30 s budget for ten pages, whatever the range: pdf.js decodes each full-page scan while listing the page's drawing, and the extractor also re-encoded every picture it would only name. The error said nothing about what to do, and the agent fell back to `pdf_render`, into #526.

## What Changes

- A tool returning pictures (`pdf_render`, and `pdf_extract`, `docx_extract`, `pptx_extract` with `images`) returns at most as many as the active model declares it accepts, under the tool's own cap, and says so with the range or numbers to ask for next.
- Before each model call the request keeps its newest images within the model's declared limits; each older one is replaced, in that request only, by a line saying it was left out and can be asked for again. The stored conversation keeps them all.
- `pdf_extract`'s budget is a base plus a share per page asked for, under a ceiling. A budget spent part-way through a range returns the pages read with the page to start again from; a whole-document call that runs out says which step ran out, after which pages, and what range to ask for.
- Pictures a call does not return are named with their format and size and not encoded.

## Capabilities

### Modified Capabilities

- `pdf-documents`: `BoundedExtractionOutput`, `PageImagesAreMarkedAndReturnable`, `DrawPdfPagesAsPictures`; adds `RequestsStayWithinTheModelImageLimit`.

## Impact

- `server/src/modelImageLimit.ts` (new): reading the limits, `withinImageLimits`, the `context` extension, registered in both runtimes (`index.ts`, `piOutpostTools.ts`).
- `server/src/pdf.ts`, `pdfTool.ts`, `extractedPictures.ts`, `docxTool.ts`, `pptxTool.ts`.
- Docs: where to declare a model's image limit.
- Nothing changes for a model that declares no limit, except the PDF budget and the truncation on time.
