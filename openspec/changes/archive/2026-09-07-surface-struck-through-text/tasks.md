## 1. Fixtures

- [x] 1.1 Add a `docx-formatting` fixture to `server/test/fixtures/make-docx.mjs`: a paragraph with a struck middle run, a double-struck run, a run declaring `w:strike w:val="false"`, a bold run, an italic run, a struck-and-bold run, an underlined paragraph, a sentence split across several struck runs, a struck run with a leading and trailing space, a whitespace-only struck run, a paragraph whose `<w:pPr><w:rPr><w:strike/>` marks only the paragraph mark, a table cell containing a struck run, and a tracked deletion beside a manual strike. Verify by regenerating and confirming `unzip -p` shows each construct in `word/document.xml`
- [x] 1.2 Add `pdf-strike` and `pdf-strike-underline` fixtures to `server/test/fixtures/make-pdfs.mjs`: filled strike rectangles at +0.31 × font size above the baseline, hyperlink underlines below it, a stroked page rule, a strike covering only part of a line, a strike over a table cell, and a thin filled rectangle far above a line that must not mark it. Verify by regenerating and confirming `extractPdf` still returns the existing fixtures' text unchanged

## 2. DOCX run formatting

- [x] 2.1 Add a run-formatting reader to `parseBody` in `server/src/docx.ts`: parse `<w:rPr>` for `w:strike`, `w:dstrike`, `w:b` and `w:i` with OOXML toggle semantics (absent `w:val`, `"true"`, `"1"`, `"on"` are on; `"false"`, `"0"`, `"off"` are off), and ignore any `<w:rPr>` nested inside `<w:pPr>`. Verify with unit tests over the reader covering each toggle spelling and the paragraph-mark case
- [x] 2.2 Change the paragraph and cell accumulators from `string[]` to spans carrying their formatting, keeping `DocxBlock` and `renderBlock` unchanged. Verify the existing `server/test/docx.test.ts` suite passes untouched — a document with no formatted run must extract byte-identically
- [x] 2.3 Implement `renderSpans()`: merge adjacent spans with equal formatting, move leading and trailing whitespace outside the markers, drop spans with no visible text, and wrap in the fixed order strike → bold → italic. Verify with unit tests for the merge, the whitespace move, the empty-span drop and the nesting order (design.md D1, D3)
- [x] 2.4 Wire the spans through table cells and confirm markers survive `escapeCell` unchanged. Verify with a test asserting the struck cell renders as a span and the row keeps its column count (spec: `MarkedTextInATableCell`)
- [x] 2.5 Add the spec's DOCX scenarios as tests in `server/test/docx.test.ts`, named after the scenarios, asserting the returned markdown rather than the parser's internals

## 3. PDF strikethrough

- [x] 3.1 Add a page-drawing reader to `server/src/pdf.ts` over `page.getOperatorList()` that tracks the CTM through `save`/`restore`/`transform` and yields each path's bounding box in page space, tagged filled or stroked. Verify with a unit test over the `pdf-strike` fixture asserting the box coordinates the generator placed
- [x] 3.2 Implement the strike/underline discriminator (design.md D5): filled, thin relative to the line's font size, overlapping the line's x range, classified by baseline offset — below 0.10 underline, 0.10–0.55 strike, above 0.55 ignored. Verify with unit tests over the fixture's strikes, underlines, page rule and far-above rectangle
- [x] 3.3 Add `struck` to `TextPiece` and carry it through `buildLines`, `lineCells` and `renderPage`, merging adjacent struck pieces into one span. Verify the existing `server/test/pdf.test.ts` suite passes unchanged for fixtures with no strikes
- [x] 3.4 Implement partial coverage: mark a whole piece at ≥ 90 % x overlap, otherwise split the piece's text at the word boundary nearest the proportional cut. Verify with the partially struck line in the fixture (spec: `PartiallyStruckLine`)
- [x] 3.5 Wrap the drawing read so a page whose operator list cannot be read still returns its text unmarked, and so the read runs inside the existing per-page deadline. Verify with a test that forces `getOperatorList()` to reject and asserts the page's text is still returned (spec: `UnreadableDrawingOperations`)
- [x] 3.6 Add the spec's PDF scenarios as tests in `server/test/pdf.test.ts`, named after the scenarios, asserting the returned markdown

## 4. Cost and regression

- [x] 4.1 Measure per-page extraction time on the `pdf-long` fixture before and after, and record the numbers in the change. Verify the existing budget tests still pass and that the long-document timings leave the default 30 s budget with the same headroom class it had (spec: `DetectionStaysWithinTheBudget`)
- [x] 4.2 Re-run the extraction against the real Word PDF that prompted the change and confirm the struck sentence now comes back as `~~Copiez l'une des requêtes ci-dessous.~~` while the three hyperlink underlines and the two page rules mark nothing. This is the acceptance check the fixtures cannot make — record the result in the change
- [x] 4.3 Re-run against a real `.docx` with no strikethrough (the `Proposition atelier jeux` document) and confirm its extraction is unchanged apart from bold and italic markers

## 5. Documentation and closure

- [x] 5.1 Update the `extract_docx_content` and `extract_pdf_content` tool descriptions so the model knows `~~` means the document crossed that text out, and state in each that the detection reads direct run formatting only (DOCX) and drawn strikes only (PDF)
- [x] 5.2 Review `docs/` and the READMEs for claims about what extraction returns, and update what the change makes stale. Record the result as the PR's `Documentation impact` note
- [x] 5.3 Write `openspec/changes/surface-struck-through-text/scenario-coverage.md` mapping every scenario in both delta specs to its test file and test name, then run `npm run check:scenarios`
- [x] 5.4 Run `npm run lint`, the server test suite, and `openspec validate --strict surface-struck-through-text`
