# Scenario coverage

OpenLore's MCP server was not connected in this session and its CLI produced no index;
targeted inspection of `git.ts`, `GitMenu.tsx`, `graph/*`, `useAgent.ts` and the git spec
stood in.

Scenarios enumerated with `rg '^#### Scenario:' openspec/changes/git-commit-metro-map`.
New tests carry an `openlore: scenario=<name> spec=git` annotation.

The running app was also driven (`scripts/probes/git-metro-server.mts` behind the bench's
host page): a merged `feature`, two unmerged branches (`topic` newer than HEAD), an
annotated tag on the merge and a lightweight one on HEAD. The DOM read back put every
`main` commit on lane 0 in emerald, `topic`, `feature` and the long branch on lanes 1–2,
branch names and tags on the right rows, in both themes. Then the monkey pass: nine rapid
toggles of the menu; a commit and a new branch made from a terminal with the menu open
(the map redrew without being reopened — it did not before this change); a checkout of
`topic` from the terminal (the chip and the map followed, `topic`'s commit on lane 0 as
HEAD); a click on a side-branch commit (its patch opened, the menu closed). No page error.

| Scenario | Status | Test file and name |
|---|---|---|
| LogListed | covered | `server/test/git.test.ts`: `gitLog returns commit history in reverse order` (exactly two subjects, newest first) and `gitLog respects the limit` (limit 1 → one entry). |
| LogSpansLocalBranches | covered | `server/test/git.test.ts`: `LogSpansLocalBranches: …` — the unmerged `topic` is listed (exact subject list), named at its tip; exactly one entry, the merge, marked HEAD. |
| TagsAreNamed | covered | `server/test/git.test.ts`: `TagsAreNamed: …` — `v1` (lightweight) and `v0` (annotated) in `tags` at their commits, `refs` empty there; `main` in `refs`, not `tags`. |
| ParentsSkipHiddenCommits | covered | `server/test/git.test.ts`: `ParentsSkipHiddenCommits: …` — the merge's parents are exactly `[c2, f1]` with `feat`'s tip (only touching a file outside the root) absent. Without `--parents` the second parent is the hidden tip; checked by hand on the same history. |
| ParentsBeyondTheLimitAreDropped | covered | `server/test/git.test.ts`: `ParentsBeyondTheLimitAreDropped: …` — with limit 3 every named parent is listed, and `c2`'s parents are `[]`. |
| LogIsScopedToTheNamedRepository | covered | `server/test/git-multi-repo.test.mjs`: annotated `LogIsScopedToTheNamedRepository`; `server/test/git-repos.test.ts`: `the log of one repository carries none of the other's commits`. |
| CommitDiffShown | covered | `server/test/git.test.ts`: `gitShow returns a commit patch`; `ui/src/components/GitMenu.test.tsx`: `still opens a commit's patch from the map` (`onShowCommit("", "fff0000")` from a side-branch row). |
| OversizedPatchTruncated | covered | `server/test/git.test.ts`: `gitShow truncates an oversized patch instead of refusing it`. Unchanged. |
| CommitIdFromAnotherRepository | covered | `server/test/git-multi-repo.test.mjs`: annotated `CommitIdFromAnotherRepository`; `server/test/git-repos.test.ts`: `a commit id from one repository is not resolved against another`. Unchanged. |
| TheCheckedOutLineRunsOnTheFirstLane | covered | `ui/src/components/graph/commitGraph.test.ts`: `TheCheckedOutLineRunsOnTheFirstLane: …` — HEAD's chain on lane 0 under a newer branch on lane 1, nothing `through` lane 0 above HEAD; `ui/src/components/GitMenu.test.tsx`: `TheCheckedOutLineRunsOnTheFirstLane: …` — rendered node x and fill (`CURRENT_COLOR`), and no line at lane 0's x in the newer row. |
| AMergeJoinsTwoLines | covered | `ui/src/components/graph/commitGraph.test.ts`: `AMergeJoinsTwoLines: …` — `forkTo [1]` at the merge, `mergeFrom [1]` at the base; `ui/src/components/GitMenu.test.tsx`: `AMergeJoinsTwoLines: …` — the rendered curves end on lane 1 at the merge row's foot and the base row's top. |
| ABranchTipNamesItsBranch | covered | `ui/src/components/GitMenu.test.tsx`: `ABranchTipNamesItsBranch: …` — each name on its own row, the checked-out one bold and emerald, the other neither, none on the base; `ui/src/components/graph/commitGraph.test.ts`: `ABranchTipNamesItsBranch: …` — an unmerged tip has no line above. |
| ATaggedCommitShowsItsTag | covered | `ui/src/components/GitMenu.test.tsx`: `ATaggedCommitShowsItsTag: …` — the tag named on its row with title `tag v1.0.0`, square where the branch is round. |
| TheMapFollowsAnOutsideCommit | covered | `ui/src/useAgent.test.ts`: `TheMapFollowsAnOutsideCommit: …` — `git_changed` for another repository sends no `git_log`; for the one held, exactly one `git_log` for it. Also observed in the running app (above). |
