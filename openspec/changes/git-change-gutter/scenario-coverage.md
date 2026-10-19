# Scenario coverage

OpenLore had no analysis index for this branch; targeted inspection of `CodeEditor.tsx`,
`FileViewer.tsx`, `useAgent.ts`, `git.ts`, `workspace.ts` and `fileWatcher.ts` stood in.

Scenarios enumerated with `rg '^#### Scenario:' openspec/changes/git-change-gutter`.
Every test below carries an `openlore: scenario=<name> spec=git` annotation.

The running app was also driven (`scripts/probes/git-gutter-server.mts` behind the bench's
host page): marks at lines 5, 21 and 41 of a modified file; the peek of a removal between
lines 39 and 41, with no revert in the source view; a revert in the editor leaving the file
on disk unchanged; undo; rapid clicks; then, from a terminal, a commit (marks and `M` badge
gone within 1.5 s), `reset --soft` plus `checkout -b` (marks back, chip on `feature`, no
work-tree file touched), the file deleted with the peek open (peek and marks gone, no error),
and `.git` removed (server alive, git surface gone, no error).

| Scenario | Status | Test file and name |
|---|---|---|
| ChangedLinesAreMarked | covered | `ui/src/components/CodeEditor.test.tsx`: `ChangedLinesAreMarked: …` — exactly `["modified", "added", "deleted"]`, the removal marked at the foot of the last line. |
| TheMarksFollowTheDraft | covered | `ui/src/components/CodeEditor.test.tsx`: `TheMarksFollowTheDraft: …` — an added mark appears on typing a line and goes when it is removed, with no save. |
| TwoDistantEditsStayApart | covered | `ui/src/components/gitGutter.test.ts`: `TwoDistantEditsStayApart: …` — two one-line hunks in a 2 000-line file, exactly. |
| NoMarksWithoutAComparableHead | covered | `ui/src/useAgent.test.ts`: `NoMarksWithoutAComparableHead: no gutter for an untracked file, nor once the file is clean again` (no request for untracked; cleared when the status drops the file) and `…: the gutter goes, without an error banner, when HEAD's text cannot be compared` (cleared, `errors` empty); `ui/src/components/CodeEditor.test.tsx`: `draws nothing without HEAD's text, and drops the marks when it goes`. |
| TheGutterFollowsHead | covered | `ui/src/useAgent.test.ts`: `TheGutterFollowsHead: …` — a status re-read asks again, a stale answer is ignored, the latest is kept; `ui/src/components/CodeEditor.test.tsx`: `TheGutterFollowsHead: …` — a new HEAD recomputes the marks and closes a peek on the old one. |
| AClickShowsHeadsText | covered | `ui/src/components/CodeEditor.test.tsx`: `AClickShowsHeadsText: …` — the peek holds exactly HEAD's line. |
| AChangeIsRevertedIntoTheDraft | covered | `ui/src/components/FileViewer.test.tsx`: `AChangeIsRevertedIntoTheDraft: …` — the draft becomes HEAD's text, the mark goes, `onSave` is never called. |
| TheSourceViewOffersNoRevert | covered | `ui/src/components/FileViewer.test.tsx`: `TheSourceViewOffersNoRevert: …` — HEAD's text shown, no revert button. |
| AnOutsideCommitIsAnnounced | covered | `server/test/git-changed.test.mjs`: `AnOutsideCommitIsAnnounced: …` — over the socket, `git_changed` names `projB`; `ui/src/useAgent.test.ts`: `AnOutsideCommitIsAnnounced: …` — the client sends exactly one `git_status` for `projB`. |
| AnOutsideCheckoutMovesTheBranch | covered | `server/test/git-changed.test.mjs`: `AnOutsideCheckoutMovesTheBranch: …` — the status read after the announcement reports branch `feature`. |
| ReadingTheStatusIsNotAChange | covered | `server/test/gitMetadataWatcher.test.ts`: `ReadingTheStatusIsNotAChange: …` — two status reads on a stale index announce nothing; a plain `git status` in the same setup was checked to fire the watcher, so the test can fail. |
| ALinkedWorkTreeIsFollowed | covered | `server/test/gitMetadataWatcher.test.ts`: `ALinkedWorkTreeIsFollowed: …` — a commit in a `git worktree add` tree is announced. |

## Coverage margin

UI function coverage, measured locally with the CI's command: 93.14% on `main`, 94.00% here.
The confirmations cleared by a 2.5 s timer in `TimelineView` and `StructuredExchangeView`
were covered only when a run outlived the timer, which is why CI read 92.98% on `310bacb`;
they are now driven by fake timers.
