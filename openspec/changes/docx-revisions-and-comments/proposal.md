# Proposal

## Why

The user needs the agent to help with impact analysis of the changes made to a specification (a
*cahier des charges*). Those changes travel as Word tracked changes, and the discussion around them
travels as comments. `docx_extract` hides both today: it returns the accepted text, with insertions
merged in and deletions dropped, and it never reads `word/comments.xml`. So the agent cannot see
what changed, who changed it, or why it was questioned. That is exactly what an impact analysis
starts from.

## What Changes

- `docx_extract` gains an opt-in `review` parameter. With it, the extraction marks each tracked
  change where it sits:
  - insertions, deletions and moves, using CriticMarkup-style markers that carry a reference
    number;
  - each comment, on the text it is anchored to, with its replies and whether it was resolved.
  - A closing list then gives every revision and comment with its author, its date and the
    heading it falls under, so a reader can start from the list and go to the text.
- Formatting changes are not reported: the need is the content.
- The default does not change. Without `review`, the extraction stays the accepted text, and
  deleted text still cannot reach the caller.
- Without `review`, a document that holds unresolved tracked changes or comments says so in one
  line and names the parameter. The agent learns the review layer exists without paying for it.
- Fixes to the accepted-text reading, found while planning. They apply in both modes:
  - a moved passage is returned once, at its destination, not also at its origin;
  - a table row deleted with tracking is dropped, not returned as a row of empty cells;
  - the *previous* formatting that Word keeps in a tracked formatting change (`w:rPrChange`,
    `w:pPrChange`) is no longer read as current. A paragraph restyled from a heading to body text
    no longer comes back as a heading, and strikethrough removed with tracking no longer comes
    back struck.
- The tool stays read-only. Nothing accepts, rejects or edits a revision or a comment.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `docx-documents`:
  - `AcceptedTextOnly` changes: the accepted text stays the default, and it now also covers moves,
    deleted rows and tracked formatting.
  - New requirement for the opt-in review reading: revisions and comments marked in place, plus
    the closing list.
  - New requirement for the hint shown in the default reading when a review layer is present.
  - `ReportEmptyDocument` changes: comments are read when `review` is set, so "comments are not
    read" no longer holds unconditionally.

## Impact

- `server/src/docx.ts`:
  - `parseBody` records the revision and comment anchors;
  - new reading of `word/comments.xml` and `word/commentsExtended.xml`;
  - the rendering of markers and of the closing list.
- `server/src/markdownSpans.ts` may need a span kind for revisions alongside the formatting flags.
- `server/src/docxTool.ts`:
  - the `review` parameter;
  - the tool description and its line on tracked changes and comments.
- Tests in `server/test/docx.test.ts`, `server/test/docxReview.test.ts` and
  `server/test/docxTool.test.ts`. They use packages built inline, plus one document edited in
  Office for the web.
- Out of scope, deferred:
  - **Open WebUI**: the tool server does not receive files attached in a chat, so reading them
    needs its own design. The extractor would also have to move into `office/` to be shared.
  - **Revisions outside the body** (headers, footers, footnotes): not read today either.
  - **Auto-numbering** of headings: section references such as "4.2" that Word generates are not
    in the text.
