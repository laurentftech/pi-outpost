# viewer-find-in-page Specification

## Purpose
Lets a reader search within a document open in the full-size file viewer — plain text, code,
Markdown (source or rendered), an in-progress edit, or a PDF — instead of scrolling to find a word
by eye, the way Ctrl+F does in a native document reader.

## Requirements

### Requirement: OpenAndCloseFindBar

The file viewer SHALL open a find bar when Ctrl+F or Cmd+F is pressed while the viewer is open and
the displayed content is searchable (plain text, code, Markdown in either view, an in-progress
edit, or a loaded PDF — not an image, not the git-diff view, not the side-by-side split view). The
key SHALL be captured by the viewer, not left to the browser's own find. Opening the bar SHALL
focus its query field; if a previous query exists, it SHALL be preselected so retyping replaces it.

Pressing Escape while the find bar is open SHALL close the find bar and clear any match
highlighting, without closing the file viewer. Escape pressed again afterward SHALL close the
viewer, exactly as it does today when no find bar is open.

#### Scenario: OpenWithCtrlF
- **GIVEN** the file viewer is open on a text, Markdown, or PDF file
- **WHEN** the user presses Ctrl+F (Cmd+F on macOS)
- **THEN** the find bar appears with its query field focused, and the browser's own find is not triggered

#### Scenario: ReopenKeepsThePreviousQuery
- **GIVEN** the find bar was used and then closed, with a query still in it
- **WHEN** the user presses Ctrl+F again
- **THEN** the bar reopens with that query shown and selected

#### Scenario: EscapeClosesTheFindBarFirst
- **GIVEN** the find bar is open
- **WHEN** the user presses Escape
- **THEN** the find bar closes, its highlighting is cleared, and the file viewer stays open

#### Scenario: EscapeThenClosesTheViewer
- **GIVEN** the find bar is closed and the file viewer is open
- **WHEN** the user presses Escape
- **THEN** the file viewer closes, as it does without this feature

#### Scenario: FindNotOfferedOutsideSupportedViews
- **GIVEN** the viewer is showing an image, a git diff, or the side-by-side split mode
- **WHEN** the user presses Ctrl+F
- **THEN** no find bar opens and the browser's own find is not suppressed

### Requirement: NavigateMatches

The find bar SHALL show how many matches exist and which one is current (for example "3/17"), and
SHALL let the user step to the next match (Enter, or a next control) or the previous one (Shift+Enter,
or a previous control), wrapping from the last match to the first and back. Matching SHALL be a
plain, case-insensitive substring search; it is not a regular-expression or whole-word search.

#### Scenario: StepForwardWraps
- **GIVEN** the find bar is showing the last of several matches as current
- **WHEN** the user moves to the next match
- **THEN** the first match becomes current

#### Scenario: StepBackwardWraps
- **GIVEN** the find bar is showing the first of several matches as current
- **WHEN** the user moves to the previous match
- **THEN** the last match becomes current

#### Scenario: CaseInsensitiveByDefault
- **GIVEN** a document containing "Outpost" but the typed query is "outpost"
- **WHEN** the query is evaluated
- **THEN** the occurrence of "Outpost" counts as a match

#### Scenario: NoMatches
- **GIVEN** a query that matches nothing in the document
- **WHEN** the find bar evaluates it
- **THEN** it shows "0/0" (or equivalent), no match is highlighted, and no error is reported

### Requirement: SearchFollowsTheDisplayedText

The find bar SHALL search whatever text the viewer is currently displaying for the open file: the
rendered Markdown text in rendered mode, the highlighted source text in source mode, or the live
edit buffer while a file is being edited — never a version of the text that is not what the reader
is looking at. Switching between rendered and source mode, or starting or leaving an edit, while
the find bar is open SHALL re-evaluate the query against the newly displayed text and SHALL NOT
silently keep stale match positions.

#### Scenario: SearchTracksEditsInProgress
- **GIVEN** a writable file open for editing, with the find bar open and a query matching text in
  the buffer
- **WHEN** the user types more text into the buffer that changes which lines contain the query
- **THEN** the match count and positions update to reflect the buffer's current content, not the
  file as last saved

#### Scenario: SwitchingModeReEvaluatesTheQuery
- **GIVEN** the find bar is open on the rendered Markdown view with an active match
- **WHEN** the user switches to source view
- **THEN** the same query is re-evaluated against the source text and the match count reflects it

### Requirement: HighlightAndScrollToMatch

For plain text, code, and Markdown (either view), every match currently in the displayed text SHALL
be visually marked, with the current match visually distinguished from the others (for example, a
stronger highlight color), and the current match SHALL be scrolled into view when it becomes
current — by navigation, by opening the find bar, or by a query that changes which match is current.

#### Scenario: AllMatchesMarkedCurrentOneStandsOut
- **GIVEN** a document with several occurrences of the query visible in the current view
- **WHEN** the find bar is open
- **THEN** every occurrence is marked, and the current one is visually distinguishable from the rest

#### Scenario: NavigatingScrollsTheMatchIntoView
- **GIVEN** the current match is outside the visible scroll area
- **WHEN** the user moves to it
- **THEN** the view scrolls so the match becomes visible

### Requirement: EditModeUsesNativeSelection

While the open file is being edited (the textarea buffer), the current match SHALL be indicated by
selecting its text in the textarea and giving the textarea focus, relying on the browser's own
scroll-into-view-on-selection behavior. Because a textarea's value carries no markup, matches other
than the current one SHALL NOT be highlighted while editing; the match count SHALL still be
accurate.

#### Scenario: CurrentMatchIsSelectedInTheEditor
- **GIVEN** a file open for editing with the find bar showing a current match
- **WHEN** that match becomes current
- **THEN** its exact text is selected in the textarea and the textarea is scrolled so the selection
  is visible

#### Scenario: OtherMatchesAreNotMarkedWhileEditing
- **GIVEN** a file open for editing with several matches
- **WHEN** the find bar is open
- **THEN** only the current match is indicated (via selection); the others are not visually marked
  on the page

### Requirement: PdfWholeDocumentSearch

For a PDF, the find bar SHALL search the whole document's text, not only the pages currently
rendered. Opening the find bar on a PDF (or entering the first query) SHALL trigger the document's
text to be read page by page for search purposes; the match count and navigation SHALL become
usable incrementally as pages are read rather than waiting for the entire document, and SHALL
indicate that the count may still grow while reading continues. A page that carries no text (a
scanned image) contributes no matches from that page, and this SHALL NOT be reported as an error.

#### Scenario: MatchOnAPageNotYetRendered
- **GIVEN** a multi-page PDF with a match on a page far from the one currently shown
- **WHEN** the user searches for that text
- **THEN** the match is found and can be navigated to, even though that page has not been rendered
  yet

#### Scenario: PartialResultsWhileIndexingContinues
- **GIVEN** a long PDF whose pages are still being read for search
- **WHEN** the user is shown the match count
- **THEN** matches found so far are navigable and the display indicates that more may still be
  found

#### Scenario: ScannedPageContributesNoMatches
- **GIVEN** a PDF page with no extractable text
- **WHEN** the document is searched
- **THEN** no match is reported from that page, and no error is shown for it

### Requirement: PdfMatchHighlightOnPage

Navigating to a PDF match SHALL move the view to the page it is on and highlight it at its exact
position on the page, the way a native PDF reader's find does — using the same text-layer
positions the viewer already places over the rendered page for text selection. If the target page
is not yet rendered when the match becomes current, the viewer SHALL render it first and then
highlight the match.

#### Scenario: NavigatingToADistantMatchJumpsPages
- **GIVEN** the current PDF page has no match and the next match is several pages away
- **WHEN** the user moves to the next match
- **THEN** the view moves to the page containing that match, which is rendered, and the match is
  highlighted at its position on the page

#### Scenario: HighlightFollowsSubsequentMatchesOnTheSamePage
- **GIVEN** a page with more than one match
- **WHEN** the user steps between matches on that same page
- **THEN** the highlighted position moves between them without leaving the page
