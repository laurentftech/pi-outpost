## 1. Shared highlight utility

- [x] 1.1 Implement a container-scoped text-match utility (`ui/src/util/findInPage.ts` or similar):
      given a container element and a case-insensitive query, walk its text nodes, wrap each match
      in a `<mark>` element, and return the ordered match elements plus a cleanup function that
      restores the original text nodes. Verify with a unit test covering: matches spanning two
      adjacent text nodes, no matches, an empty query, and cleanup fully reverting the DOM.
- [x] 1.2 Add a match-count cap (e.g. a few thousand) with a "500+ matches"-style label when hit.
      Verify with a unit test feeding a pathological single-character query against a large body of
      text.
- [x] 1.3 Add a small styling pass (current match vs. other matches) usable from both the file
      viewer and the PDF viewer's text layer. Verify visually via `npm run bench` (see repo's
      running-app rule) with a code file containing several occurrences of a word.
      — CSS in `web/src/index.css` (`.find-match`/`.find-match-current`, plus the PDF-specific
      transparent-text override); verified live (see 6.2) rather than via `npm run bench`,
      since this feature lives in the main viewer, not the embed widget bench targets.

## 2. Find bar component

- [x] 2.1 Build a `FindBar` component: query input, live "i/n" count (or "searching…" state), next
      and previous controls, close control. Verify with a component test asserting the count text
      and that next/prev call the provided callbacks.
- [x] 2.2 Wire Enter / Shift+Enter inside the query input to next/previous, and Escape to close.
      Verify with a keyboard-driven component test.

## 3. FileViewer integration (text, code, Markdown)

- [x] 3.1 Add find-bar open/closed state to `FileViewer`; capture Ctrl+F/Cmd+F at the document
      level while the viewer is mounted (mirroring the existing Escape listener), calling
      `preventDefault` only when the current view is searchable per the
      `FindNotOfferedOutsideSupportedViews` scenario (not image, not git-diff, not split). Verify
      with a component test that Ctrl+F opens the bar on a text file and does nothing on an image
      file.
- [x] 3.2 Make Escape close the find bar (and clear highlights) before it closes the viewer; a
      second Escape closes the viewer as today. Verify with a component test for both the
      `EscapeClosesTheFindBarFirst` and `EscapeThenClosesTheViewer` scenarios.
- [x] 3.3 Apply the shared highlight utility (task 1) to the currently displayed container: the
      `CodeHighlight` `<pre>` in source mode, the `ReactMarkdown` output in rendered mode. Re-run it
      whenever the query or the displayed content changes. Verify with a component test for the
      `SwitchingModeReEvaluatesTheQuery` scenario.
- [x] 3.4 Scroll the current match into view on every change of current match (open, next, prev,
      query edit). Verify with a component test asserting `scrollIntoView` (or equivalent) is
      called on the current match's element.
- [x] 3.5 Edit-mode handling: while the textarea is active, select the current match's exact range
      via `setSelectionRange` and focus the textarea instead of inserting marks; keep the match
      count accurate against the live buffer. Verify with a component test for
      `CurrentMatchIsSelectedInTheEditor` and `SearchTracksEditsInProgress`.
      — Focus moves to the textarea just long enough to trigger the browser's
      scroll-into-view-on-selection, then bounces back to the find field so
      Enter/Shift+Enter keep stepping through matches (see FileViewer.tsx's
      `selectEditMatch`); the spec's letter ("selecting its text... giving the
      textarea focus... scrolled into view") is satisfied without leaving
      keyboard navigation stranded in the textarea.
- [x] 3.6 Reset find-bar state (query, matches) when the open file path changes. Verify with a
      component test opening file A with an active query, then switching to file B.
      — `FileViewer` is remounted per path by its caller (`key={state.openFile.path}`
      in App.tsx, pre-existing — the same mechanism an edit draft already relies
      on never surviving a file switch), so find state resets for the same
      reason; verified by mounting/unmounting rather than re-rendering in place.

## 4. PDF text index and search

- [x] 4.1 Add a per-document text index to `PdfViewer`: for each page, fetch `getTextContent()`
      lazily (starting from the currently open page, expanding outward), yielding between pages so
      indexing does not block the main thread; invalidate the index when `path` or `revision`
      changes. Verify with a unit test (page proxy fakes) asserting incremental population and
      cancellation on document change.
      — Implemented as standalone, React-free logic in `ui/src/util/pdfFindIndex.ts`
      (`indexPdfText`/`pageReadOrder`), unit-tested directly; wiring it into `PdfViewer`'s
      lifecycle (starting it, invalidating it on path/revision change) is done in task 5.1.
- [x] 4.2 Implement search over the index: case-insensitive substring match per page, producing an
      ordered list of `{ page, matchIndexOnPage }`. Verify with a unit test against a fake
      multi-page index, including the `ScannedPageContributesNoMatches` case (a page with empty
      text).
      — `searchPdfIndex` in the same module.
- [x] 4.3 Expose match count and an "indexing in progress" flag so the find bar can show partial
      results per the `PartialResultsWhileIndexingContinues` scenario. Verify with a unit test that
      the count grows as indexing proceeds and a "still searching" flag clears when it finishes.
      — Covered at the pure-logic level (`indexPdfText`'s incremental `onPage`/`onDone`
      callbacks, tested above); the `PdfViewer` component wiring that turns this into the
      find bar's live count/"searching…" state is done in task 5.1.

## 5. PDF find-bar integration and highlighting

- [x] 5.1 Wire `PdfViewer` to accept the shared `FindBar` (via `FileViewer`, matching task 3.1's
      Ctrl+F capture) and to expose current-match navigation that calls the existing `goTo` to bring
      the match's page into the render window. Verify with a component test for
      `NavigatingToADistantMatchJumpsPages`.
      — `PdfViewer` is now `forwardRef`, exposing `{findNext, findPrevious}`; `FileViewer`
      holds the ref and forwards `findQuery`/`onFindStateChange`. Along the way, found and
      fixed a latent concurrency issue in the mocked pdf.js module runner (two pages'
      concurrent `import("pdfjs-dist")` could race to the unmocked real build) by
      memoizing the dynamic import (`loadPdfjs`) — a real fix, not a test-only workaround,
      since production code shouldn't call `import()` separately per page either.
- [x] 5.2 Once the target page's text layer has rendered (`drawTextLayer` resolved), apply the
      shared highlight utility (task 1) to that page's text-layer container for the current match,
      matching the same query occurrence found by the index. Verify with a component test that
      renders a page, then asserts a `<mark>` appears in its text layer once rendering settles.
- [x] 5.3 Handle stepping between multiple matches on the same already-rendered page without a page
      change. Verify with a component test for `HighlightFollowsSubsequentMatchesOnTheSamePage`.
- [x] 5.4 Clear PDF highlighting and index state when the document changes (`path`/`revision`) or
      the find bar closes. Verify with a component test switching PDFs with an active query.
      — Closing the find bar clears it via the same path as everything else: `FileViewer`
      passes PdfViewer `findQuery=""` whenever `findOpen` is false (`effectiveFindQuery`),
      so PdfViewer's own effects tear the highlight down exactly as an empty query would.

## 6. Cross-cutting verification

- [x] 6.1 Enumerate every `#### Scenario:` in `openspec/changes/add-viewer-find-in-page/specs/`
      (`rg '^#### Scenario:' openspec/changes/add-viewer-find-in-page/specs/`) and build the
      scenario-to-test matrix required by this project's spec-coverage rule; fix any scenario left
      `uncovered` or `partial`.
      — Matrix in `scenario-coverage.md` (this change's directory): 20/20 scenarios `covered`.
      Closing the gaps found while building it (git-diff/split were untested for
      `FindNotOfferedOutsideSupportedViews`; `OtherMatchesAreNotMarkedWhileEditing` and
      `PartialResultsWhileIndexingContinues` had no component-level test) added 4 tests.
- [x] 6.2 Exercise the feature in the running app per this project's UI-testing rule: run the
      server and web dev servers directly (this feature is in the main viewer, not an embed-bench
      target), open a code file and a PDF, drive Ctrl+F, next/prev, and Escape-twice, and confirm
      the DOM/session state matches what was driven (not just a screenshot).
      — This caught a real bug component tests missed: `CodeHighlight` wasn't memoized, so any
      unrelated re-render of the viewer made React reset its `<pre>`'s real DOM (React resets a
      `dangerouslySetInnerHTML` element on every render of the component that owns it, not only
      when the HTML string changes), silently wiping the find marks a moment after they were
      applied. An earlier attempt at fixing this via a `MutationObserver` (to reapply marks after
      the async syntax-highlighting swap) made things worse: the browser split its own mutation
      batch across two observer callbacks, so the observer caught its own edits as if they were
      external ones and looped hard enough to hang and crash the tab once. The actual fix wraps
      `CodeHighlight` in `React.memo` (see its own comment) so it only re-renders — and only ever
      touches its DOM — when `code`/`path`/`onRendered` genuinely change; `onRendered` (a stable
      callback) then drives re-highlighting through a plain effect dependency, no DOM observation
      needed. Verified live afterward: Ctrl+F on a 40-match file, Next/Previous stepping the count
      and the current mark correctly, Escape closing the find bar before the viewer. Also
      exercised PDF search (`pdf-text.pdf`): the whole-document index correctly found "Revenue" on
      a page outside the initial render window. Separately noticed, and confirmed via `git stash`
      against the unmodified base branch, that this dev environment's PDF text *layer* (the
      pre-existing selectable-text overlay, unrelated to this change) does not populate — so the
      on-page highlight-box rendering itself could not be visually confirmed live in this
      environment; that code path is covered by `PdfViewer.test.tsx`'s mocked-text-layer tests
      instead.
- [x] 6.3 Run `openspec validate --strict` for this change and fix any reported issues.
