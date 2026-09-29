## 1. Confirm what pdf.js gives

- [ ] 1.1 Build a fixture page carrying a note, a reply (`/IRT`, `/RT /R`), a state reply (`/State /Accepted /StateModel /Review`), a highlight with `/QuadPoints`, a strike-out, a caret, a popup, a link, a form field and a rectangle without `/Contents`, in `server/test/fixtures/make-pdfs.mjs` (raw objects through `objectsExtra`, `/Annots` on the page). Print `page.getAnnotations()` for it and record which fields arrive: `subtype`, `id`, `contentsObj`, `titleObj`, `modificationDate`, `creationDate`, `rect`, `quadPoints`, `inReplyTo`, `replyType`, `state`, `stateModel`.
- [ ] 1.2 Confirm the corner order and coordinate space of `quadPoints` as pdf.js returns them, against a highlight drawn over a string at a known position (`textWidth` gives its extent). The design relies only on each quad's bounding box; confirm that box lands on the string.
- [ ] 1.3 Confirm whether `getTextContent()` returns any text from a `FreeText` annotation's appearance. If it does, decide how to avoid the text box's words appearing twice, and record it in design.md.

## 2. Reading comments

- [ ] 2.1 Read `getAnnotations()` per page inside the page's time budget, keep markup annotations per design.md — What counts as a comment, and drop `Link`, `Widget`, `Popup`. Verify by unit test over the fixture of 1.1 (spec: WhatIsNotACommentIsLeftOut).
- [ ] 2.2 Rebuild replies and states from `inReplyTo`, `replyType` and `state`; list an orphan reply at the top level. Verify by unit test (spec: RepliesAndStatesFollowTheirComment).
- [ ] 2.3 Parse PDF dates to `YYYY-MM-DD`, falling back from `modificationDate` to `creationDate`, and leave out a date that does not parse. Verify by unit test over well-formed, offset-less, truncated and garbage dates.
- [ ] 2.4 Recover the marked passage from `quadPoints` and the page's text pieces, widening a partial piece to word boundaries, capped at 200 characters; anchor a caret to its nearest word. Verify by unit test on a whole-word highlight, a partial-word one and one across two lines (spec: AHighlightQuotesItsPassage, AHighlightAcrossTwoLines).

## 3. Writing the block

- [ ] 3.1 Render the per-page `Comments on page N` block per design.md: kind label, author, date, quoted anchor, remark as blockquote lines, replies nested, states last. Verify by unit test on the exact output for the fixture (spec: ANoteIsReturnedWithItsPage, SuggestionsAreNamed).
- [ ] 3.2 Quote remarks line by line and fold author names and anchors to one line, removing control characters. Verify with a remark reading `## Page 9` / `> Truncated` (spec: ARemarkCannotPassForStructure).
- [ ] 3.3 Add the leading notice beside the strike-through notice, with the `tables` mode variant, and no line when there is no comment. Verify on documents with and without comments, in each mode (spec: CommentsAreAnnounced, NoCommentsAnnounceNothing, TablesModeLeavesCommentsOut).
- [ ] 3.4 Cap at 50 comments per page and 2 000 characters per remark, saying what was left out, and count the block toward the character cap. Verify with a 60-note fixture (spec: ManyCommentsAreCapped).
- [ ] 3.5 Keep the page when `getAnnotations()` throws or times out, with a line saying its comments could not be read. Verify with a stubbed page whose annotation read fails (spec: UnreadableAnnotationsDoNotFailThePage).
- [ ] 3.6 Check that the page text is unchanged by comments: extract the annotated fixture and the same page without `/Annots`, and compare the content before the comments block (spec: AnchoringLeavesTheTextAlone).

## 4. The tool

- [ ] 4.1 Update the `pdf_extract` description: comments are returned after each page's content, with the text they mark. Verify by reading the assembled description back in `pdfTool.test.ts`.
- [ ] 4.2 Check that `output_path` writes the comments with the rest of the extraction.
- [ ] 4.3 Update `docs/` where `pdf_extract`'s output is described.

## 5. Proof

- [ ] 5.1 Write `scenario-coverage.md` with every scenario of this change as `covered`, citing the test and its assertions, and run `npm run check:scenarios`.
- [ ] 5.2 In the running app, ask the agent what the reviewers said about an annotated PDF, and read the session transcript: the answer must quote the comments. Repeat with a PDF that has none: the agent must not invent any.
- [ ] 5.3 Run the fixture generator and the PDF suites on Windows through CI; check new tests for string-built paths and CRLF assumptions.
