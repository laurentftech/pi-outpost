# Tasks

## 1. The model's image limit (#526)

- [x] 1.1 Read `inputLimits.images.maxPerRequest` / `maxPerMessage` from the active model (`server/src/modelImageLimit.ts`), ignoring malformed values. Verify with `server/test/modelImageLimit.test.ts`.
- [x] 1.2 Cap `pdf_render` and the extractors' `images` at the model's limit, under the tools' own caps, and say so in the result. Verify with `server/test/pdfRender.test.ts` and `server/test/extractedPictures.test.ts`.
- [x] 1.3 Keep each request's newest images within the limit with a `context` extension registered in both runtimes, leaving a line where an image was dropped and the stored conversation untouched. Verify with `server/test/imageLimitWire.test.mjs` against a provider playing a gateway that refuses more than 4 images, and check the test fails with the extension unregistered.

## 2. The extraction budget (#527)

- [x] 2.1 Measure where the time goes on a scanned document. Measured: ten A4 300 dpi pages with an OCR layer, 11.3 s; `getTextContent` 67 ms, `getOperatorList` 7.3 s (pdf.js decoding the scans), the rest encoding pictures nobody asked for.
- [x] 2.2 Encode only the pictures the call returns; name the others with the format encoding would give. Verify with `server/test/pdfBudget.test.ts`, "pictures not asked for are named with their format, and carry no bytes".
- [x] 2.3 Make the budget a base plus a share per page, under a ceiling; return the pages read when it runs out mid-range; name the step, the pages read and the range to ask for when it cannot. Verify with `server/test/pdfBudget.test.ts` and the existing budget tests in `server/test/pdf.test.ts`, with no unhandled rejection after a test ends.

## 3. In the running app

- [x] 3.1 Live agent (OpenRouter `nvidia/nemotron-3.5-super-vl:free`, declared at 4 images per request through `modelOverrides`; `google/gemma-4-31b-it:free` was rate-limited upstream): asked to look at every page of a ten-page PDF, it called `pdf_render`, received 4 pages and the note, asked for `5-10`, then `9-10` was offered; it re-asked page 1 after the older pages left the request, and answered. A second turn drew `5-8`. No turn failed. `pdf_extract` on a twelve-page synthetic scan read pages 1–10 in one call and answered from page 10.
- [x] 3.2 Monkey pass: `images: "all"` on the scan under the limit (pictures over 2 MB held back and named; asked for by number, one returned and the rest named), an abort during a slow extraction, then a new turn. Found: the note blamed the model's limit when the 4 MB byte budget was what stopped the pictures — fixed, with a test. Not changed: `pdf_extract` does not observe the abort, so the extraction finishes before the turn stops (as before this change).

## 4. Documentation

- [x] 4.1 `docs/how-to.md`: declaring a model's image limit (`models` and `modelOverrides`), the gateway's error in the troubleshooting table, the scanned-PDF budget. Verify the JSON parses and the anchor resolves.
