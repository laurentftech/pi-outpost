## 1. Protocol

- [x] 1.1 Add `GitFileLogEntry` to `shared/src/protocol.ts`: `sha`, `parents: string[]`, `author`, `date`, `subject`, `path` (path at that commit), `added`, `deleted`.
- [x] 1.2 Add the `GitRevision` type — `{ rev: string; path: string }` where `rev` is a commit id or the literal `"worktree"` — plus the client requests `git_file_log` (`path`, `limit?`, `requestId`) and `git_file_diff` (`base`, `target`, `requestId`).
- [x] 1.3 Add the server responses `git_file_log` (`path`, `entries`) and `git_file_diff` (`base`, `target`, `beforeText`, `afterText`) — both echoing the revisions so the client can drop a reply that no longer matches its selection.

## 2. Server: file log

- [x] 2.1 Add `gitFileLog(root, toplevel, relPath, limit)` to `server/src/git.ts`: `--full-history -z --numstat` passes stitched across renames via a `--follow -n 1` boundary probe, limit clamped to [1, 200], stitches capped. (`toplevel` is needed to map git's toplevel-relative log paths back to browser-root paths, as `gitHeadContent` already does.)
- [x] 2.2 Write the record parser: split on `\x1e`, strip the NUL `-z` puts at the end of each header; treat a record whose first field is not 40 hex chars as a continuation of the previous subject; read NUL-separated numstat fields, taking the rename form (`added`, `deleted`, `oldpath`, `newpath`) for the path at that commit.
- [x] 2.3 Prune each entry's parents to ids present in the returned set; link an entry left with no present parent to the next entry in log order.
- [x] 2.4 Unit-test `gitFileLog` against a fixture repo: linear history, a rename crossed by the stitch, a merge commit touching the file (kept, two parents), every entry connected, the clamp, an untracked file (empty list, no error), and a subject containing `\x1e`.

## 3. Server: revision pair content

- [x] 3.1 Add `gitRevisionContent(root, toplevel, rev, relPath)` reusing `gitHeadContent`'s toplevel-prefix computation and `git show <rev>^{commit}:<path>`; a path missing at that revision returns `""` via the existing "not in HEAD" error match.
- [x] 3.2 Reject any `rev` that is neither the exact literal `"worktree"` nor a match for `SHA_PATTERN`, before any process is spawned.
- [x] 3.3 Unit-test: content at a commit, at the pre-rename path, at a revision predating the file (empty), a tag id peeled by `^{commit}`, a blob id refused (must not read as an empty side), and a malformed revision or the worktree marker refused with no spawn.

## 4. Server: handlers

- [x] 4.1 Add `handleGitFileLog` in `server/src/index.ts` following the existing git-handler shape: refuse when `GIT === null`, confine the path via a new `assertWithinRoot` export (confinement only — a deleted or oversized file still has a history), `git_error` on failure.
- [x] 4.2 Add `handleGitFileDiff`: confine both sides' paths independently, resolve each side (worktree via `readFileForPreview` with `not-found` swallowed to `""`, commit via `gitRevisionContent`), then apply the 1 MiB and NUL-byte checks to both sides as `handleGitDiff` does.
- [x] 4.3 Wire both into `handleClientMessage`.
- [x] 4.4 Integration-test through the server harness: a file log over the websocket, a commit↔commit diff, a commit↔worktree diff, a path escaping the browser root refused with `git_error` and no spawn, and an oversized side refused.

## 5. UI: shared rail

- [x] 5.1 Move `LANE_W`, `ROW_H`, `CURRENT_COLOR`, `BRANCH_COLORS` and `laneColor` out of `ui/src/components/TreeMenu.tsx` into `ui/src/components/graph/lanes.ts`.
- [x] 5.2 Move `Rail` into `ui/src/components/graph/Rail.tsx`, generalising its row descriptor with optional `mergeFrom: number[]` (curves arriving into the node, mirroring the `forkTo` bezier) and an optional `dashed` flag.
- [x] 5.3 Update `TreeMenu` to import both. It turned out to have no tests of its own, so the guard this task assumed did not exist: added `graph/Rail.test.tsx` covering both shapes (tree rows with `forkTo`/`through`, git rows with `mergeFrom`/`dashed`) instead.

## 6. UI: lane layout

- [x] 6.1 Add `layoutFileGraph(entries): { rows, laneCount }` in `ui/src/components/graph/fileGraph.ts` — the active-lane sweep from design.md, pure and React-free, with lane 0 held by the newest commit.
- [x] 6.2 Prepend the working-tree row on lane 0, dashed when the file is clean per `git_status`.
- [x] 6.3 Unit-test the layout: linear history (one lane), a merge (a second lane opens at the merge and closes where it rejoins), lane reuse after a branch ends, and stable lane assignment for a fixed input.

## 7. UI: history pane

- [x] 7.1 Create `ui/src/components/GitFileHistory.tsx` on `GitCommitView`'s overlay pattern (`absolute inset-0 z-30`, capture-phase Escape with `stopImmediatePropagation`), split into a `26rem` history column and a diff column, stacking below `768px` with the history capped at 40% height.
- [x] 7.2 Build the row: bracket gutter, `Rail`, mono amber short id, truncated subject, author, relative date, right-aligned `+n −n` with an `aria-label` spelling out the counts.
- [x] 7.3 Draw the comparison bracket in the gutter spanning base→target, capped and labelled `base` / `target`, in zinc so it never competes with the lane colours; animate top and height over `150ms ease-out` inside a `prefers-reduced-motion: reduce` guard.
- [x] 7.4 Implement selection: hover/focus-revealed `base` and `target` ghost buttons using `TreeMenu`'s `ACTION_CLASS`; a plain row selection sets target and, with no base set, takes the first parent as base; the row already in the other slot is `aria-disabled` and fires no request; header `swap ⇄` and `clear`.
- [x] 7.5 Implement keyboard support: roving focus with `↑`/`↓`, `Enter` for plain selection, `b` and `t` for the roles, `Escape` to close; visible focus on every row and control.
- [x] 7.6 Render the diff with the existing `diffLines` + `SplitDiffBlock`, headed by `<base> → <target>` using the same short ids and arrow direction as the bracket.
- [x] 7.7 Implement the states and copy from design.md: `Reading history…`, `No commits touch this file yet.`, `Pick a commit to see what changed.`, `Now pick the version to compare it against.`, dimmed previous diff while loading, git error verbatim with the list still live, and `These two versions are identical.`.

## 8. UI: wiring

- [x] 8.1 Add file-log and file-diff request/response handling and state to `ui/src/useAgent.ts`, dropping any `git_file_diff` reply whose revision pair no longer matches the current selection.
- [x] 8.2 Add the history affordance to `ui/src/components/FileViewer.tsx` beside the `± diff` toggle, rendered whenever git is available (not gated on uncommitted changes), opening the pane for the open file.
- [x] 8.3 Component-test `GitFileHistory`: opening from the viewer, one-click showing a commit's own effect, replacing a slot, the same-revision case firing no request, swap reversing the diff, clear returning to the prompt, Escape closing only the pane, and the error state keeping the list usable.

## 9. Close out

- [x] 9.1 Run the full test suite and the build (the stylesheet check included — the new component introduces classes the Tailwind scan must see). Server 295/295, UI 333/333, `npm run build` and `check:css` clean.
- [x] 9.2 Run `openspec validate --changes add-git-file-history --strict` (passes) and `openlore drift`. Drift reports 6 gaps against `openspec/specs/*`; that is expected while the change is unarchived — it compares code to the *main* specs, which the delta only updates at archive time.
- [ ] 9.3 **Blocked**: `record_decision` is not exposed — the openlore MCP server runs the default substrate-core preset, and the `openlore decisions` CLI can consolidate/approve/sync but not create. Needs `openlore install --preset full` (a change to the user's MCP wiring) before the three decisions can be recorded: the stitched `--full-history` + `--follow`-probe log strategy, the parent-pruning fallback rule, and the shared rail extraction.
