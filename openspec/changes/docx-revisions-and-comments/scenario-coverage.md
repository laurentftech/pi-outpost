# Scenario coverage

OpenLore's `orient` returned no briefing in this session (index unavailable). Targeted
inspection of `server/src/docx.ts`, `server/src/docxTool.ts`, `server/src/markdownSpans.ts` and
the `docx-documents` spec stood in.

Scenarios enumerated with `rg '^#### Scenario:' openspec/changes/docx-revisions-and-comments`:
44 scenarios, every one listed below. Most new tests carry the scenario name in their title.
The inline packages in `server/test/docxReview.test.ts` are written in Word's markup. One
fixture, `server/test/fixtures/docx-review-office-web.docx`, was edited in Office for the web,
so the reading is also checked against markup this code did not write.

| Scenario | Status | Test file and name |
|---|---|---|
| TrackedInsertionIsKept | covered | `server/test/docx.test.ts`: `keeps an insertion and drops a deletion` (`The rate is fifteen percent.`). |
| TrackedDeletionIsDropped | covered | `server/test/docx.test.ts`: `drops it in every mode, because deletion is a property of the walk` (text, tables, both); `server/test/docxReview.test.ts`: `DefaultReadingIsUnchanged` (no `30`). |
| MovedTextAppearsOnce | covered | `server/test/docxReview.test.ts`: `MovedTextAppearsOnce: …` — the sentence occurs exactly once, after `# Annexes`. |
| DeletedTableRowIsDropped | covered | `server/test/docxReview.test.ts`: `DeletedTableRowIsDropped: …` — exact row list without the deleted row; Office web fixture: `the accepted reading drops the deleted row …` (no `Routes`, cells as ordinary runs). |
| PreviousParagraphStyleIsNotRead | covered | `server/test/docxReview.test.ts`: `PreviousParagraphStyleIsNotRead: …` — body line, no `#`, in both readings. |
| PreviousRunFormattingIsNotRead | covered | `server/test/docxReview.test.ts`: `PreviousRunFormattingIsNotRead: …` — no `~~` or `**`, in both readings. |
| DocumentWithNoBodyText | covered | `server/test/docx.test.ts`: `says the body is empty and names what it does not read`. |
| ContentOutsideTheBody | covered | `server/test/docx.test.ts`: `says the body is empty and names what it does not read` (header-only fixture); `server/test/docxReview.test.ts`: `ContentOutsideTheBody: comments are named as unread only outside the review reading`. |
| StruckTextIsAnnouncedBeforeTheContent | covered | `server/test/docx.test.ts`: `StruckTextIsAnnouncedBeforeTheContent: …`. That fixture also holds a tracked deletion, so it now proves the notice still leads ahead of the review hint. |
| NothingStruckAnnouncesNothing | covered | `server/test/docx.test.ts`: `NothingStruckAnnouncesNothing: …`. Unchanged. |
| StruckRunIsMarked | covered | `server/test/docx.test.ts`: `StruckRunIsMarked: …`. Unchanged. |
| DoubleStrikeIsMarked | covered | `server/test/docx.test.ts`: `DoubleStrikeIsMarked: …`. Unchanged. |
| FormattingTurnedOffIsNotMarked | covered | `server/test/docx.test.ts`: `FormattingTurnedOffIsNotMarked: …`. Unchanged. |
| BoldAndItalicAreMarked | covered | `server/test/docx.test.ts`: `BoldAndItalicAreMarked: …`. Unchanged. |
| UnderlineIsNotMarked | covered | `server/test/docx.test.ts`: `UnderlineIsNotMarked: …`. Unchanged. |
| CombinedFormattingNestsWithoutAmbiguity | covered | `server/test/docx.test.ts`: `CombinedFormattingNestsWithoutAmbiguity: …`. Unchanged. |
| AdjacentRunsWithTheSameFormattingBecomeOneSpan | covered | `server/test/docx.test.ts`: `AdjacentRunsWithTheSameFormattingBecomeOneSpan: …`. Unchanged. |
| WhitespaceStaysOutsideTheMarkers | covered | `server/test/docx.test.ts`: `WhitespaceStaysOutsideTheMarkers: …`. Unchanged. |
| RunWithNoVisibleTextEmitsNoMarkers | covered | `server/test/docx.test.ts`: `RunWithNoVisibleTextEmitsNoMarkers: …`. Unchanged. |
| ParagraphMarkFormattingDoesNotReachTheRuns | covered | `server/test/docx.test.ts`: `ParagraphMarkFormattingDoesNotReachTheRuns: …`. Unchanged. |
| MarkedTextInATableCell | covered | `server/test/docx.test.ts`: `MarkedTextInATableCell: …`. Unchanged. |
| StrikethroughIsNotATrackedDeletion | covered | `server/test/docx.test.ts`: `StrikethroughIsNotATrackedDeletion: …` (default reading). |
| StrikethroughIsNotATrackedDeletionInReview | covered | `server/test/docxReview.test.ts`: `StrikethroughIsNotATrackedDeletionInReview: …` — exact line `Garde ~~barre~~{--SUPPRIME--}[r1] fin.` |
| InsertionAndDeletionAreMarkedInPlace | covered | `server/test/docxReview.test.ts`: `InsertionAndDeletionAreMarkedInPlace` — exact paragraph line. |
| MoveIsMarkedAtBothEnds | covered | `server/test/docxReview.test.ts`: `MoveIsMarkedAtBothEnds: …` — both ends carry `[m1]`, no `[m2]`. |
| AdjacentRunsOfOneRevisionBecomeOneMarker | covered | `server/test/docxReview.test.ts`: `AdjacentRunsOfOneRevisionBecomeOneMarker` (three runs → one marker), and `two revisions by different authors stay two markers` as its negative. |
| FormattingChangeIsNotMarked | covered | `server/test/docxReview.test.ts`: `FormattingChangeIsNotMarked: …` — bold marked, no revision marker, legend says no review layer. |
| RevisionInATableCell | covered | `server/test/docxReview.test.ts`: `RevisionInATableCell: …` — exact row, every row keeps two columns. |
| DeletedTableRowIsKeptInReview | covered | `server/test/docxReview.test.ts`: `DeletedTableRowIsKeptInReview: …` — both cells in deletion markers with one `[r1]`, listed as `table row deletion`; Office web fixture: `the review reading marks every change once …` (`[r6]` on all three cells). |
| DefaultReadingIsUnchanged | covered | `server/test/docxReview.test.ts`: `DefaultReadingIsUnchanged: …` — no marker or reference pattern, no deleted text. |
| CommentIsMarkedOnItsText | covered | `server/test/docxReview.test.ts`: `CommentIsMarkedOnItsText: …` (the replies' repeated anchors add no `[c2]`); Office web fixture: comment on a heading, `## {==Who talks to whom==}[c1]`. |
| CommentOverARevision | covered | `server/test/docxReview.test.ts`: `CommentOverARevision: …` — exact nesting `{=={++45 jours++}[r1]==}[c1]`. |
| CommentsAreNotReadByDefault | covered | `server/test/docxReview.test.ts`: `CommentsAreNotReadByDefault` — no comment text, anchor or reference. |
| RevisionEntryNamesAuthorDateAndSection | covered | `server/test/docxReview.test.ts`: `RevisionEntryNamesAuthorDateAndSection` — exact entries with the two-level path, list order, and list after the content. |
| CommentEntryCarriesItsThread | covered | `server/test/docxReview.test.ts`: `CommentEntryCarriesItsThread: …` — exact three lines; `an unresolved thread says open; no extended part says the state is not recorded`. |
| MissingAuthorOrDateIsNotInvented | covered | `server/test/docxReview.test.ts`: `MissingAuthorOrDateIsNotInvented` — exact entry. |
| ReviewOfADocumentWithNoReviewLayer | covered | `server/test/docxReview.test.ts`: `ReviewOfADocumentWithNoReviewLayer: …` — legend line, text intact, no list. |
| SameReferenceInARangedCall | covered | `server/test/docxReview.test.ts`: `SameReferenceInARangedCall` — `[r3]` in the whole reading and in block "30" alone, listed in the ranged call. |
| TruncatedReviewListsOnlyWhatItShows | covered | `server/test/docxReview.test.ts`: `TruncatedReviewListsOnlyWhatItShows` — `[r1]`/`[r2]` listed, no `[r3]`/`[r4]`, truncation note, legend counts 2. |
| DocumentTextLookingLikeAMarker | covered | `server/test/docxReview.test.ts`: `DocumentTextLookingLikeAMarker: …` (exact escaped line, no list), `a marker split across runs is still escaped`, `the default reading's text is left exactly as it was`. |
| ReviewLegendLeads | covered | `server/test/docxReview.test.ts`: `ReviewLegendLeads: …` — first block gives "3 tracked changes and 1 comment" and every marker, before the first heading. |
| HintNamesTheParameter | covered | `server/test/docxReview.test.ts`: `HintNamesTheParameter: …` — whole-document counts (4 and 1) in a one-block call; `server/test/docxTool.test.ts`: `review is opt-in, and the default answer names it …`. |
| NoReviewLayerNoHint | covered | `server/test/docxReview.test.ts`: `NoReviewLayerNoHint: …` — output is exactly `**important**`. |
| SourceUnchangedAfterReview | covered | `server/test/docxTool.test.ts`: `SourceUnchangedAfterReview: …` — source bytes equal before and after a review answer and an `output_path` write; the written file holds the list. |
