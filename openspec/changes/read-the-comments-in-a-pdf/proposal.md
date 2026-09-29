## Why

A PDF that has been reviewed carries its review as annotations: sticky notes, highlighted passages
with a remark, text a reviewer struck out or marked for insertion, replies between reviewers, and
"Accepted" / "Rejected" states. None of it is in the page's content stream, so none of it is in the
text layer `pdf_extract` reads. Asked "what did the reviewers say about this contract?", the agent
answers from the clean text and reports that there are no remarks. The document says the opposite.

This is the same failure `StruckThroughTextIsMarked` fixed for drawn strikes: the extraction returns
something the document contradicts, and the caller has no way to know. Here it is worse, because a
review's whole point is the annotations.

The data is already within reach. pdf.js 6.2.108, already in the tree, returns a page's annotations
through `page.getAnnotations()`. Checked in its worker code (`MarkupAnnotation`, `TextAnnotation`,
the text-markup classes), each annotation carries:

- `subtype` (`Text`, `FreeText`, `Highlight`, `Underline`, `Squiggly`, `StrikeOut`, `Caret`, `Ink`,
  `Square`, `Stamp`, `Popup`, `Link`, `Widget`…) and `id` (its object reference, e.g. `"12R"`);
- `contentsObj.str`, the comment's plain text, and `titleObj.str`, its author;
- `modificationDate` and `creationDate`, as PDF date strings;
- `rect`, and for text markup `quadPoints`, the exact boxes of the marked text;
- `inReplyTo` (the `id` of the annotation it answers) and `replyType` (`R` for a reply, `Group`);
- for a note, `state` and `stateModel`: how Acrobat records a review status as a reply.

## What Changes

- **`pdf_extract` returns a page's comments with that page.** After the page's content, a
  `Comments` block lists each comment: its kind, author, date and text. Replies are nested under the
  comment they answer, and a review state ("Accepted by Paul") is shown on the comment it applies to.
- **Marked text is quoted.** A highlight, underline, squiggle, strike-out or caret names the text it
  marks. That text is recovered by intersecting the annotation's `quadPoints` with the positions of
  the page's text pieces, which the extraction already has.
- **A reviewer's deletion or insertion is named as a suggestion.** A `StrikeOut` annotation is a
  suggested deletion and a `Caret` a suggested insertion. They are said so, even without a remark,
  because the mark itself is the reviewer's message.
- **The extraction says up front that comments exist.** As for struck text, a line before the first
  page's content counts the comments and says where they are, so a reader who stops early cannot
  miss them. A document without comments carries no such line.
- **What is not a comment is left out.** Links, form fields (`Widget`) and `Popup` annotations (the
  window that displays another annotation's text) are not comments.
- **The tool description says comments are read.**

Nothing is removed. An existing call returns what it returns today, plus comments where the document
has them.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `pdf-documents`: extraction returns a page's review comments with the text they mark, their
  replies and review states, and announces them before the content.

## Impact

- **Reading**: `server/src/pdf.ts` (read annotations per page, anchor them, render the block),
  `server/src/pdfTool.ts` (description).
- **Fixtures**: `server/test/fixtures/make-pdfs.mjs` gains annotation dictionaries on a page; the
  generator already writes raw objects (`objectsExtra`), so no library is needed.
- **Tests**: `server/test/pdf.test.ts`, `server/test/pdfTool.test.ts`.
- **No new dependency.**
- **Context budget**: comments count toward the same character cap as the text. A heavily annotated
  document is capped per page, and the output says what was left out.
- **Not addressed**:
  - The PDF *viewer* in the UI. pdf.js may already draw annotations there; that is display, not
    extraction.
  - Comments in Word documents (`word/comments.xml`). The same need, a different format and a
    separate change; a `.docx` is the more reliable source for a Word review anyway, since a PDF
    exported from Word usually drops its comments.
  - Writing or answering comments.
