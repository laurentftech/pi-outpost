# Scenario coverage — see-the-images-in-a-document

Capabilities: `docx-documents` (2 requirements, 9 scenarios), `pptx-documents` (1 requirement,
5 scenarios), `pdf-documents` (3 requirements, 10 scenarios). Twenty-four in all, verified against
`rg '^#### Scenario:' openspec/changes/see-the-images-in-a-document/specs/`.

Six of these first had tests only for the shared helper or the parser, not for the reader or the tool
a caller reaches. They are marked here against the level that actually holds the contract, and the
missing tests were written rather than the matrix being written around them.

The fixtures are named where it matters, because two of them decide what a test is worth:

- `pdf-scan.pdf` models a scan as *absence of text* — a filled rectangle, no image at all. It is
  therefore the fixture for `VectorPageWithNoTextIsDrawn`, and it cannot serve any scan scenario.
- `pdf-image-rgb.pdf`, `pdf-image-bilevel.pdf`, `pdf-image-undecodable.pdf` and
  `pdf-text-then-image.pdf` are new, one per bitmap kind the encoder has to choose between, built in
  `make-pdfs.mjs` so CI needs nothing installed.

## docx-documents

| Scenario | Coverage | Evidence |
| --- | --- | --- |
| PictureIsMarkedInPlace | covered | `server/test/docx.test.ts` — "the marker goes where the picture sits, and the paragraphs keep their order" asserts the blocks come back as `["Before", "[picture 1]", "After"]` and that the resolver was handed `rId7`; "a picture inside a sentence stays inside it" asserts `"see [picture 1] here"`, so an inline picture is not lifted out of its paragraph; "a picture in a table cell is marked in that cell" asserts the cell's row is `["Region", "[picture 1]"]`. "a real package's picture is named where it sits" then asserts on `docx-report.docx` that the markdown matches `/Un risque de délai\.\s*\n\s*\[picture 1: PNG 2×1\]\s*\n\s*# Conclusion/` — the marker between the paragraph before it and the heading after it, with the format and pixel dimensions its bytes state. |
| AlternativeTextIsCarried | covered | `server/test/docx.test.ts` — "alternative text comes from descr, with its XML entities decoded" asserts the resolver receives `Ventes "Q3" & marges` from `descr="Ventes &quot;Q3&quot; &amp; marges"`, so entities are decoded rather than passed through. `server/test/extractedPictures.test.ts` — "names the format, the size and the alt text" asserts the marker reads `[picture 3: PNG 800×600 — "Revenue by region"]`, and "alt text cannot break the marker it sits in" asserts a `]` and a newline inside alt text cannot end the marker early. |
| UnreadablePictureIsStillNamed | covered | `server/test/docx.test.ts` — "UnreadablePictureIsStillNamed: the marker says the package does not hold the part" repoints the fixture's blip at a relationship the package lacks, then asserts `pictures[0].bytes` is undefined, that `unavailable` names the reason, that the markdown carries `[picture 1: picture; the package does not hold the part it points at]`, and that the rest of the document still came through. `server/test/extractedPictures.test.ts` — "a picture whose bytes cannot travel is still named, with the reason" asserts the marker's shape for that case. |
| DocumentWhoseOnlyContentIsAPicture | covered | `server/test/docx.test.ts` — "a picture is content: the document is not reported as empty" replaces the body with the paragraph holding the drawing and asserts the whole markdown is `[picture 1: PNG 2×1]` with no "no extractable body content"; the sibling test asserts a genuinely empty body still says so, and that its note no longer lists images among what is not read. |
| NoPictureBytesByDefault | covered | `server/test/docxTool.test.ts` — "by default a picture is named and its bytes stay behind" calls the tool with no `images` argument and asserts the text carries the marker while the image content is exactly `[]`. |
| PicturesReturnedOnRequest | covered | `server/test/docxTool.test.ts` — `"all" returns the picture, announced by its own marker` asserts one image block of `image/png` with non-empty data, and that the block at the marker's index + 1 is that image — so a transcript with several pictures says which is which. |
| OnePictureByIdentifier | covered | `server/test/docxTool.test.ts` — "a picture can be asked for by the number its marker carries" asserts both `["1"]` and `["picture 1"]` return one image; "an identifier naming no picture is refused, and says what is there" asserts the refusal names `"4"` and the range `1–1`. `server/test/extractedPictures.test.ts` — "a number is read from any spelling the marker could have suggested" pins the accepted spellings. |
| BudgetIsStatedNotSilent | covered | `server/test/extractedPictures.test.ts` — "the per-call count cap holds, and the answer says how many were left and where to resume" asserts 8 returned of 11 and a note naming `3 further pictures` and `starting at 9`; "the per-call byte cap holds even when the count would allow more" asserts the byte ceiling stops it with the count cap unreached; "a picture over the per-picture ceiling waits for its own call" and "naming that picture is the way to get it, whatever its size" assert the way back. |
| OneUnpreparablePictureDoesNotFailTheCall | covered | `server/test/docx.test.ts` — "OneUnpreparablePictureDoesNotFailTheCall: a good picture beside a bad one still travels" duplicates the drawing with its blip repointed at nothing, then asserts two pictures, the first with bytes and the second without, and both marked. `server/test/extractedPictures.test.ts` — "one unpreparable picture does not fail the call" asserts the selection returns the good one and says why the other did not. |

## pptx-documents

| Scenario | Coverage | Evidence |
| --- | --- | --- |
| SlidePictureIsMarked | covered | `server/test/pptx.test.ts` — "a picture is marked where the shape tree puts it" asserts the blocks are exactly `[{kind:"text",text:"Title"}, {kind:"picture",text:"[picture 1]"}]`, in that order; "alternative text comes from the shape's descr" asserts the resolver receives `Revenue by region`. `server/test/pptxToolPictures.test.ts` builds a deck with `pptx_create` and asserts the marker reads `[picture 1: PNG 2×1 — "Revenue by region"]`, so format, size and alt text all arrive from a package the writer really produced. |
| SlideWhoseOnlyContentIsAPicture | covered | `server/test/pptx.test.ts` — "reports a visual-only slide rather than returning nothing" asserts on `pptx-visual.pptx` that the slide names its picture and that the old `1 image and 1 chart` unread count is gone. That fixture holds no media part, so the marker states that instead of claiming bytes — which is the honest reading of it, and the test asserts `pictures[0].bytes` is undefined to say so. |
| SlidePictureBytesOnRequest | covered | `server/test/pptxToolPictures.test.ts` — "SlidePictureBytesOnRequest: asking returns it, announced by its marker" asserts one `image/png` block with non-empty data and that it follows its marker; "a picture can be asked for by the number its marker carries" asserts `["1"]` returns it and `["5"]` is refused. |
| NoSlidePictureBytesByDefault | covered | `server/test/pptxToolPictures.test.ts` — "NoSlidePictureBytesByDefault: the picture is named and its bytes stay behind" asserts the marker is in the text and the image content is `[]`. |
| AChartIsNotAPicture | covered | `server/test/pptx.test.ts` — "a chart is not a picture" asserts the resolver was never called for a graphic frame, that `visuals.charts` is 1 and that no block was emitted. `server/test/pptxToolPictures.test.ts` — "AChartIsNotAPicture" asserts that on a deck holding a picture and a chart, `images: "all"` returns exactly one image, and the chart's slide says `Not read: 1 chart.` with no marker. `server/test/pptx.test.ts` — "a marked picture is no longer counted among what was not read" asserts a slide never both names a picture and calls it unread. |

## pdf-documents

| Scenario | Coverage | Evidence |
| --- | --- | --- |
| ScannedDocument | covered | `server/test/pdf.test.ts` — "reports a scan instead of returning nothing" asserts the document-level note on `pdf-scan.pdf`; "a page with no text says how to look at it, images before drawing" asserts the note names `images: "all"` and `pdf_render` **and that the first comes before the second** in the sentence, which is the part that stops a caller reaching for the weaker route; "a page drawn with no image at all still says so" asserts the per-page line says `no image to return either` and names `pdf_render`. |
| MixedScanAndText | covered | `server/test/pdf.test.ts` — "names the image-only pages of a part-scanned document" asserts page 1's text is returned and page 2 is named as having no text layer, without the document-level note firing. "a marker lands on the page that drew it" asserts on `pdf-text-then-image.pdf` that page 1 holds no marker and page 2 holds `[picture 1: JPEG 8×8]`. |
| ScannedPageIsItsOwnImage | covered | `server/test/pdf.test.ts` — "a bilevel scan stays lossless, because JPEG rings around glyphs" asserts `image/png` and that width and height are the file's own 16×8, not a page width; "a photograph comes back as a JPEG, named where it was drawn" asserts `image/jpeg`, 8×8, non-empty bytes and no `unavailable`. The encoder's choice is asserted per kind in `server/test/extractedPictures.test.ts`. |
| NoImageBytesByDefault | covered | `server/test/pdfTool.test.ts` — "NoImageBytesByDefault: an existing call gets markers and no bytes" asserts the marker is in the text and the image content is `[]`. |
| ImageBudgetIsStated | covered | `server/test/pdfTool.test.ts` — "ImageBudgetIsStated: an identifier naming nothing is refused, and says what is there" asserts the refusal names `"7"` and the range `1–1`, and that a document with no images returns none rather than an empty-looking answer. The ceilings themselves and their sentences are asserted in `server/test/extractedPictures.test.ts` (see BudgetIsStatedNotSilent). |
| UndecodableImageIsStillNamed | covered | `server/test/pdf.test.ts` — "an image that cannot be decoded is named with the reason, and the page still reads" asserts on `pdf-image-undecodable.pdf` that one picture came back with no bytes, that the marker carries `[picture 1: image 8×8; `, that `unavailable` names the bitmap or the encoding, and that the page is still covered. |
| VectorPageWithNoTextIsDrawn | covered | `server/test/pdfRender.test.ts` — "VectorPageWithNoTextIsDrawn" first asserts `extractPdf(pdf-scan.pdf).pictures` is `[]`, so the test cannot pass for the wrong reason, then asserts the tool returns one `image/png` page and says `Drew 1 of 1 page(s)`. |
| PageRangeAndCount | covered | `server/test/pdfRender.test.ts` — "PageRangeAndCount" asserts `pages: "2-3"` returns two images, says `Drew 2 of 10 page(s)`, announces `Page 2:` and `Page 3:` and does not announce `Page 1:`. |
| PageCapIsStated | covered | `server/test/pdfRender.test.ts` — "PageCapIsStated" asserts exactly `MAX_DRAWN_PAGES` images, that the answer says `2 more were not drawn`, and that it names `pages="9-10"` to get them. |
| NoOfficeApplicationNeeded | covered | `server/test/pdfRender.test.ts` — "NoOfficeApplicationNeeded" asserts the tool's options carry no renderer settings at all, so there is no LibreOffice or Word path to configure and the drawing asserted in the tests above happened without one; it also asserts the description names no office application. This is a structural assertion rather than an environmental one, and it is the honest one: `rasterizePdf` has no parameter through which a converter could be reached. |

## Over a real server

`server/test/wordToolsWire.test.mjs` — "PicturesReachTheCallerOverTheWire" drives the whole loop
through a running server with a scripted model: the first call shows a marker and returns no bytes,
the second returns the picture, the third returns it by the number that marker carried, and
`pdf_render` draws a page that has neither text nor an image. It is listed separately because it does
not belong to one scenario: what it proves is that the loop *closes* — that the identifier a caller is
shown is one the next call can use, over the real protocol.

It also earned its place. It found a defect no unit test could reach: `pdf_render` was registered and
never **published**, so the agent could not have called it however well it worked — and the
no-text-layer note was advising a tool that was not on offer. `documentTools.ts` now publishes it with
the extractor, `sandbox.ts` registers it in the read-only set, and both are pinned by tests
(`server/test/documentTools.test.ts`, `server/test/sandbox-tools.test.ts`).

## Not covered by a test, and why

- **`docx-templates` alt text on write.** `docx_create` now writes `wp:docPr/@descr`, asserted in
  `server/test/docxBuild.test.ts` ("the Markdown's alt text is written as the picture's
  description", plus the no-alt and whitespace cases). That behaviour has no scenario here because
  the capability governing `docx_create` still lives in the unarchived `add-docx-from-template`
  change; the requirement belongs there when it archives. See proposal.md — What Changes.
- **CCITT, JBIG2 and JPX decoding.** `wasmUrl` is now configured, and pdf.js ships the decoders, but
  no fixture in this tree is encoded with them: hand-writing a CCITT G4 or JBIG2 stream is a
  generator of its own. The encoder is exercised on every bitmap *kind* those filters decode to
  (grayscale 1 bpp, RGB, RGBA), which is the surface this change owns — what the filters themselves
  do is pdf.js's. Recorded as the open half of task 1.2.
