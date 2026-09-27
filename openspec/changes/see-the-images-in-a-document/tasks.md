## 1. Confirm what the libraries actually give us

- [x] 1.1 Confirm the pdfjs surface for an image drawn by a page: reach `paintImageXObject` and `paintInlineImageXObject` from the operator walk already in `pdf.ts`, and get at the object through `page.objs` / `commonObjs`. Verify by printing, for `fixtures/pdf-scan.pdf` and a JPEG-bearing PDF, each image's filter, width, height and whether raw bytes are reachable.
- [x] 1.2 Establish whether any filter can be handed over untouched. Answered: none can. A Word-made PDF carrying `/Filter /DCTDecode` returns `{width:240, height:160, kind:2, dataLen:115200}` — RGB 24bpp, exactly 240×160×3 — so its 15,003-byte JPEG is already decoded by the time the operator walk sees it. Every image is therefore re-encoded on the way out, by `kind` (see design.md). Which decoders exist: `CCITTFaxStream` and `JpegStream` are pure JS in pdfjs 6.2.108; `Jbig2Stream` and `JpxStream` run from `jbig2.wasm` / `openjpeg.wasm`. Confirming those three decode a real scan needs fixtures that do not exist yet — moved to 8.2.
- [x] 1.5 Give pdfjs the wasm it needs: `pdfjsAssetDirs()` supplies `standardFontDataUrl` and `cMapUrl` but not `wasmUrl`, which pdfjs 6 takes (trailing slash required) to load `jbig2.wasm` and `openjpeg.wasm` from `pdfjs-dist/wasm/`. Without it a JBIG2 or JPX scan — the encodings scans actually use — cannot decode. Verify a JBIG2 fixture decodes with it and reports a named failure without it, and check the SEA build still finds the files (`server/scripts/build-sea.mjs`), since the worker already needed special handling there. Done: `wasmUrl` now points at `pdfjs-dist/wasm/`; 57 pdf tests still pass. SEA note: `build-sea.mjs` copies no pdfjs assets, so `pdfjsAssetDirs()` already returns nothing there through its catch — cmaps, standard fonts and now wasm are equally absent in a single-file build. Pre-existing, left as it was rather than widened here.
- [x] 1.3 Confirm the transform stack in `collectShapes` yields a usable position and on-page size for an image operator, so markers can be ordered and placed. Verify against a PDF with two images at known positions.
- [x] 1.4 Confirm how an EMF or WMF picture appears in a `.docx` package and that `readImageInfo` reports it as a format it does not support rather than throwing. Verify on a fixture authored by real Word with a pasted EMF.

## 2. The marker and the budget, once

- [x] 2.1 Add a shared marker writer producing `[picture N: FORMAT W×H — "alt"]` per design.md — Decisions, with the alt text and the trailing dash omitted when absent. Verify by unit test over present/absent alt text, an unknown size, and a name needing escaping.
- [x] 2.2 Add the identifier scheme (position in document order) and the parser that turns a caller's identifier back into a selection. Verify by unit test that identifiers are 1-based, stable for the same bytes, and that an unknown or malformed identifier is refused with a message naming it.
- [x] 2.3 Add the budget: per-call ceilings of 8 pictures and 4 MB total, and a per-picture ceiling of 2 MB above which a picture is withheld from `"all"` but reachable by identifier. Verify by unit test at each boundary, including a single picture over the per-picture ceiling and a set that crosses the per-call one.
- [x] 2.4 Add the "what was left" sentence, naming the count withheld and how to ask for it, and the marker-volume cap that collapses markers to a count past a threshold. Verify by unit test on a document with more pictures than the threshold.

## 3. Word: `docx_extract`

- [x] 3.1 Walk the document body for inline and floating pictures, resolving each drawing's relationship to its `word/media/*` part, and emit a marker at the picture's place in the flow. Verify the markdown holds the marker between the surrounding paragraphs, in order (spec: PictureIsMarkedInPlace).
- [x] 3.2 Read each picture's alt text from `wp:docPr/@descr` into the marker. Verify against a document declaring alt text (spec: AlternativeTextIsCarried).
- [x] 3.3 Add the `images` parameter (`"none"` default, `"all"`, or identifiers) returning pictures as image content. Verify the default returns no image content and that `"all"` and a single identifier each return what they name (spec: NoPictureBytesByDefault, PicturesReturnedOnRequest, OnePictureByIdentifier).
- [x] 3.4 Rasterise SVG pictures through `rasterizeSvg`; mark EMF, WMF and an unreadable or missing part as present-but-unavailable with the reason, and keep the call succeeding. Verify on a document holding one returnable and one unavailable picture (spec: UnreadablePictureIsStillNamed, OneUnpreparablePictureDoesNotFailTheCall).
- [x] 3.5 Make a document whose only content is a picture report that picture instead of "no extractable body content". Verify against the existing empty-document path so its behaviour for a genuinely empty file is unchanged (spec: DocumentWhoseOnlyContentIsAPicture).
- [x] 3.6 Update the `docx_extract` description: images are read and marked, the parameter exists, and the sentence claiming images are not read is gone. Verify by reading the assembled description back in a test.

## 4. PowerPoint: `pptx_extract`

- [x] 4.1 Emit a marker for each slide picture, with format, size, alt text from `p:cNvPr/@descr`, and an identifier. Verify a slide with a title and a picture yields both in order (spec: SlidePictureIsMarked).
- [x] 4.2 Report a slide whose only content is a picture as holding it, rather than as holding nothing readable. Verify against the existing "slide holds only unsupported content" path (spec: SlideWhoseOnlyContentIsAPicture).
- [x] 4.3 Add the same `images` parameter and budget to `pptx_extract`, reusing the group 2 code. Verify default and `"all"` on a deck with pictures on two slides (spec: SlidePictureBytesOnRequest, NoSlidePictureBytesByDefault).
- [x] 4.4 Keep a native chart, a diagram and a grouped shape named as unsupported visual content, with no picture marker and no image bytes. Verify on a deck holding a chart and no picture that asking for pictures returns none for it (spec: AChartIsNotAPicture).
- [x] 4.5 Update the `pptx_extract` description accordingly. Verify by reading the description back in a test.

## 5. PDF: the images a page draws

- [x] 5.1 Extend the operator walk to collect image operators with their placement, and emit a marker per image in page order. Verify markers and their order on a two-image PDF (spec: PageImagesAreMarkedAndReturnable).
- [x] 5.2 Return bytes at the file's own resolution: pass `DCTDecode` through untouched, decode the scan filters and re-encode as PNG via the canvas. Verify a scanned page comes back at the resolution the file holds, not a page width (spec: ScannedPageIsItsOwnImage).
- [x] 5.3 Add the `images` parameter and budget to `pdf_extract`. Verify the default returns markers only and that the budget sentence appears when a document exceeds it (spec: NoImageBytesByDefault, ImageBudgetIsStated).
- [x] 5.4 Mark an image whose encoding cannot be turned into a viewable picture, with the reason, and keep the extraction succeeding. Verify on a fixture carrying such an image (spec: UndecodableImageIsStillNamed).

## 6. PDF: `pdf_render`, and pointing at the right tool

- [x] 6.1 Add a `pdf_render` tool taking a path and an optional page range, returning page pictures and the page count through `rasterizePdf` unchanged, capped per call. Verify a range returns those pages with the document's count, and that exceeding the cap says which pages were not drawn (spec: PageRangeAndCount, PageCapIsStated).
- [x] 6.2 Verify a page with no text layer and no extractable image — vector-drawn — is returned as a picture (spec: VectorPageWithNoTextIsDrawn), and that drawing needs no office application by running with the converter lookup pointed at nothing (spec: NoOfficeApplicationNeeded).
- [x] 6.3 Rewrite the no-text-layer note to name image extraction first and drawing second, keeping the statement that OCR is not provided. Verify the note's text on `fixtures/pdf-scan.pdf` and `fixtures/pdf-mixed-scan.pdf` (spec: ScannedDocument, MixedScanAndText).
- [x] 6.4 Write `pdf_render`'s description so it reads as the second choice, and register the tool where the other document tools are registered. Verify it appears in the tool list and that its description names extraction first.

## 7. The write side: alt text in `docx_create`

- [x] 7.1 Carry a Markdown image's alt text into `wp:docPr/@descr` in `shared/src/docx.ts`, as `pptx_create` already does. Verify the written package holds the alt text, and that a picture with no alt text still writes valid markup.
- [x] 7.2 Round-trip it: create a document from Markdown with `![alt](…)`, extract it, and verify the marker carries that alt text.

## 8. Fixtures, and the machines they came from

- [ ] 8.1 Author fixtures with real Office on Windows: a `.docx` with a raster picture, an SVG, an EMF and declared alt text; a `.pptx` with a picture, a native chart and alt text. Verify each opens in Word/PowerPoint with `OpenAndRepair = false` — the synthetic fixtures in this tree have already hidden two defects that only Office-authored files exposed.
- [ ] 8.2 Add PDF fixtures in `make-pdfs.mjs`: one JPEG-bearing page, one CCITT and one JBIG2 scan, one grayscale 1-bpp image, and one undecodable image. Note that the existing `pdf-scan.pdf` models a scan as *absence of text* — a filled rectangle, no image at all — so it is the fixture for `VectorPageWithNoTextIsDrawn` and cannot serve the scan scenarios. Build them in the script so CI needs nothing installed; note any that must be committed as bytes. Verify each decodes to the `kind` design.md expects, completing what 1.2 could not.
- [ ] 8.3 Reread every new test for the Windows traps in CLAUDE.md — paths built by concatenation, `\r\n` in fixtures read as text, `npm` spawning. Verify by running the new suites on Windows before pushing.

## 9. Proving it, and the paperwork

- [ ] 9.1 Run the focused suites, then the whole server suite. Verify no existing extraction test changed behaviour except where a marker is now expected, and that each such change is intentional.
- [ ] 9.2 Drive it in the running app per CLAUDE.md: ask the agent to read a document holding a picture and read back the session transcript to confirm it asks for the picture and reports it. This change is a tool-description change as much as a code change, and the recorded failure here is an extraction option the agent kept not using — the mechanism being right is not evidence the behaviour is.
- [ ] 9.3 Hammer the transitions, not the happy path: a document whose picture part is deleted between two calls, an identifier from a previous read of a since-edited file, `"all"` on a document above every ceiling at once, a PDF whose pages are all scans, and an extraction to `output_path` whose markers must survive as plain text.
- [ ] 9.4 Write `openspec/changes/see-the-images-in-a-document/scenario-coverage.md` mapping every scenario in the three delta specs to its test, reading the assertions rather than the names. Verify with `rg '^#### Scenario:' openspec/changes/see-the-images-in-a-document/` and `npm run check:scenarios`.
- [ ] 9.5 Review documentation impact per CLAUDE.md: the four tool descriptions, `README.md` and `docs/` wherever they describe what the extractors read. Verify with a search for the claim that images are not read, and add the `Documentation impact` note to the PR.
- [ ] 9.6 Run `npm run lint`, `npm run typecheck` and `openspec validate --changes --specs --strict`, and confirm the `docx-templates` follow-up for task 7.1's requirement is recorded where `add-docx-from-template` will pick it up.
