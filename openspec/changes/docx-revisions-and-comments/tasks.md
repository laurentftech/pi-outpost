# Tasks

## 1. Fixtures

- [ ] 1.1 Add a review fixture written by desktop Word: a move between sections, a tracked restyle of a heading to body text, a tracked strikethrough removal, and a comment with two replies marked resolved. Office for the web cannot be relied on for these. Check it in under `server/test/fixtures/`, and verify that its assertions in `server/test/docxReview.test.ts` pass.
- [x] 1.2 Check in the document edited in Office for the web as `server/test/fixtures/docx-review-office-web.docx` (insertion, deletion, a replaced cell, an inserted and a deleted row, an open comment on a heading). Build the packages for every other scenario inline in `server/test/docxReview.test.ts`, in Word's markup. That covers a revision with no author or date, a forged marker, an insertion split across runs, a comment over an insertion, a formatting-only revision and revisions spread across blocks. The existing fixtures are not regenerated. Verify that `server/test/docxReview.test.ts` reads the Office web fixture and every inline package.

## 2. Accepted reading fixes

- [x] 2.1 In `parseBody`, ignore everything inside `w:rPrChange` and `w:pPrChange` (and the other `*PrChange` elements). Verify with the `PreviousParagraphStyleIsNotRead` and `PreviousRunFormattingIsNotRead` tests, in both readings.
- [x] 2.2 Drop `w:moveFrom` content in the default reading, and drop table rows whose `w:trPr` holds `w:del`. Verify with the `MovedTextAppearsOnce` and `DeletedTableRowIsDropped` tests and the Office web fixture; the existing tracked-change and strikethrough tests stay green.
- [ ] 2.3 Describe the visible effect of the default-reading fixes in the PR description, for the release changelog (written at release time per `docs/development.md` § Releasing): restyled headings, moved text, deleted rows, and the new hint line. Verify that the PR body names all four.

## 3. Revisions in the review reading

- [x] 3.1 Add optional revision markers and raw spans to `Span`, and teach `renderSpans` to merge on equal markers and to wrap them outside formatting markers. Verify with the `formatting markers nest inside revision markers` and `AdjacentRunsOfOneRevisionBecomeOneMarker` tests; the PDF and docx formatting tests stay green.
- [x] 3.2 Add `review` to `DocxExtractOptions`. Tag `w:ins`, `w:del`, `w:moveFrom`, `w:moveTo` and row revisions, group them, link moves by range name, and number `[rN]` / `[mN]` over the whole document. Verify with the `InsertionAndDeletionAreMarkedInPlace`, `MoveIsMarkedAtBothEnds`, `AdjacentRunsOfOneRevisionBecomeOneMarker`, `FormattingChangeIsNotMarked`, `RevisionInATableCell`, `DeletedTableRowIsKeptInReview` and `DefaultReadingIsUnchanged` tests.
- [x] 3.3 Escape forged markers and references in the document's own text, in the review reading only. Verify with `DocumentTextLookingLikeAMarker` and the split-across-runs test, and check that the default reading's text is unchanged.

## 4. Comments in the review reading

- [x] 4.1 Read `word/comments.xml` and `word/commentsExtended.xml` under the same zip limits. Build roots, replies and the resolved state, and report the state as not recorded when the extended part is absent. Verify with `CommentEntryCarriesItsThread`, the open/not-recorded test and the Office web fixture.
- [x] 4.2 Mark comment ranges `{==…==}[cN]` and point comments `[cN]`, including ranges spanning paragraphs and ranges over a revision. Verify with `CommentIsMarkedOnItsText`, `CommentOverARevision`, the cross-paragraph test and `CommentsAreNotReadByDefault`.

## 5. List, legend, hint and tool surface

- [x] 5.1 Record each reference's block, compute heading paths, render the closing list after the content and the review legend as a lead line. Verify with the `RevisionEntryNamesAuthorDateAndSection`, `CommentEntryCarriesItsThread`, `MissingAuthorOrDateIsNotInvented`, `ReviewOfADocumentWithNoReviewLayer` and `ReviewLegendLeads` tests.
- [x] 5.2 Restrict the list to references in the returned blocks, with numbers unchanged. Verify with `SameReferenceInARangedCall` and `TruncatedReviewListsOnlyWhatItShows`.
- [x] 5.3 Add the default-reading hint with whole-document counts, after the strikethrough notice. Make `ReportEmptyDocument` name comments as unread only outside the review reading. Verify with `HintNamesTheParameter`, `NoReviewLayerNoHint`, `ContentOutsideTheBody` and the existing `StruckTextIsAnnouncedBeforeTheContent`.
- [x] 5.4 Add `review` to `docx_extract` in `server/src/docxTool.ts`, and update the description's sentences on tracked changes and comments. Verify in `server/test/docxTool.test.ts`: the parameter passes through with `blocks`, `full` and `output_path`, and `SourceUnchangedAfterReview` compares the source bytes before and after.
- [x] 5.5 Update the docs: `README.md` (Office documents bullet), `docs/how-to.md` (Word reading section, with an example) and `docs/comparison.md` (the `docx_extract` size, raised by the measured growth of the definition, +781 chars). Verify that the documented call matches the tool schema.

## 6. Integration

- [x] 6.1 Write `openspec/changes/docx-revisions-and-comments/scenario-coverage.md`, mapping every `#### Scenario:` in the delta spec (check with `rg '^#### Scenario:' openspec/changes/docx-revisions-and-comments`) to its test. Verify that `node scripts/check-scenario-coverage.mjs --change docx-revisions-and-comments` passes (the bare `npm run check:scenarios` only sees committed changes) and that `openspec validate docx-revisions-and-comments --strict` is clean.
- [ ] 6.2 In the running app (embed bench), put the Office web fixture in the workspace, ask the agent for an impact analysis of its changes, and read the transcript. Verify that the agent called `docx_extract` with `review: true` (after the hint or directly), and that its answer cites references, authors and sections from the list. Then a break-it pass: delete the file mid-request, ask for a block range that cuts a comment range, and request the review reading on a document without a review layer.
- [ ] 6.3 Run the full server test suite and reread the new tests for Windows traps (`path.join` for paths, `/\r?\n/` splits). Verify that the suite is green.

## Workflow follow-up

- Open WebUI support stays out of this change: the tool server does not receive files attached in a chat, and the extractor must first move into `office/`. Track it as its own change.
- Archive this change from `main` after merge, not from the feature branch.
