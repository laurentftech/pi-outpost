# Scenario coverage — `viewer-find-in-page`

Enumerated via `rg '^#### Scenario:' openspec/changes/add-viewer-find-in-page/specs/` (20 scenarios).
All `covered`; none `partial` or `uncovered`.

| Scenario | Status | Test file | Test |
|---|---|---|---|
| OpenWithCtrlF | covered | `ui/src/components/FileViewer.find.test.tsx` | "opens the find bar with Ctrl+F on a text file" |
| ReopenKeepsThePreviousQuery | covered | `ui/src/components/FileViewer.find.test.tsx` | "reopens with the previous query preselected" |
| EscapeClosesTheFindBarFirst | covered | `ui/src/components/FileViewer.find.test.tsx` | "closes the find bar first on Escape, leaving the viewer open" |
| EscapeThenClosesTheViewer | covered | `ui/src/components/FileViewer.find.test.tsx` | "closes the viewer on a second Escape once the find bar is already closed" |
| FindNotOfferedOutsideSupportedViews | covered | `ui/src/components/FileViewer.find.test.tsx` | "does nothing on an image file" / "does nothing while showing a git diff" / "does nothing in the side-by-side split view" |
| StepForwardWraps | covered | `ui/src/components/FileViewer.find.test.tsx`, `ui/src/components/PdfViewer.test.tsx` | "moves to the next match with Enter and wraps around"; "wraps navigation from the last match back to the first" |
| StepBackwardWraps | covered | `ui/src/components/PdfViewer.test.tsx` | "wraps navigation from the last match back to the first" |
| CaseInsensitiveByDefault | covered | `ui/src/util/findInPage.test.ts` | "matches case-insensitively" (the exact utility both dom and pdf highlighting call) |
| NoMatches | covered | `ui/src/components/FileViewer.find.test.tsx`, `ui/src/util/findInPage.test.ts` | "shows no matches, not an error, for a query the file does not contain"; "returns no matches for a query the text does not contain" |
| SearchTracksEditsInProgress | covered | `ui/src/components/FileViewer.find.test.tsx` | "updates the match count as the buffer is edited, without moving the selection" |
| SwitchingModeReEvaluatesTheQuery | covered | `ui/src/components/FileViewer.find.test.tsx` | "re-evaluates the query when switching from rendered to source view" |
| AllMatchesMarkedCurrentOneStandsOut | covered | `ui/src/components/FileViewer.find.test.tsx` | "marks every match and distinguishes the current one" |
| NavigatingScrollsTheMatchIntoView | covered | `ui/src/components/FileViewer.find.test.tsx` | "scrolls the current match into view when navigating" |
| CurrentMatchIsSelectedInTheEditor | covered | `ui/src/components/FileViewer.find.test.tsx` | "selects the current match's exact text in the textarea" |
| OtherMatchesAreNotMarkedWhileEditing | covered | `ui/src/components/FileViewer.find.test.tsx` | "does not mark the other matches while editing — a textarea's value carries no markup" |
| MatchOnAPageNotYetRendered | covered | `ui/src/components/PdfViewer.test.tsx` | "finds matches on a page that has not been read yet only once indexing reaches it" |
| PartialResultsWhileIndexingContinues | covered | `ui/src/components/PdfViewer.test.tsx` | "shows matches found so far as navigable while indexing still has pages left to read" |
| ScannedPageContributesNoMatches | covered | `ui/src/components/PdfViewer.test.tsx`, `ui/src/util/pdfFindIndex.test.ts` | "treats a page whose text cannot be read as contributing no matches, not an error"; "reports no matches, not an error, for a page with no extractable text" |
| NavigatingToADistantMatchJumpsPages | covered | `ui/src/components/PdfViewer.test.tsx` | "jumps to a page containing the next match when it is outside the render window" |
| HighlightFollowsSubsequentMatchesOnTheSamePage | covered | `ui/src/components/PdfViewer.test.tsx` | "moves the highlight between matches on the same page without changing page" |

Assertions were read, not just test titles: each test above exercises the real
GIVEN/WHEN/THEN — e.g. `AllMatchesMarkedCurrentOneStandsOut` counts actual
`<mark class="find-match">` elements and the single `find-match-current`, not
merely that the find bar opened; `NavigatingToADistantMatchJumpsPages` waits
for the page indicator and the highlighted mark's text, not just that `goTo`
was called.

Supporting unit coverage (not scenario-mapped, but exercised as part of the
above): `ui/src/util/findInPage.test.ts` (the shared highlight/match utility),
`ui/src/util/pdfFindIndex.test.ts` (page read order, incremental indexing,
cancellation, search), `ui/src/components/FindBar.test.tsx` (the shared bar
component in isolation).
