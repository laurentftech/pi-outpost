## Context

See proposal.md — Why. The relevant existing shape:

- `server/src/git.ts` is a small read-only surface (`probeGit`, `gitStatus`, `gitHeadContent`, `gitLog`, `gitShow`) over one `runGit` helper: `execFile` with no shell, fixed argv, `cwd` at `BROWSER_ROOT`, 10 s timeout, 10 MiB buffer. Confinement comes from `cwd` + a `-- .` pathspec, not from path rewriting.
- `server/src/index.ts` git handlers all share one shape: refuse when `GIT === null`, `try`/`catch` → `git_error` with the same `requestId`. Single-file requests confine the path through `readFileForPreview` (1 MiB cap, NUL-byte binary check).
- `ui/src/components/GitCommitView.tsx` is the full-pane overlay pattern: `absolute inset-0 z-30`, Escape handled in the capture phase with `stopImmediatePropagation` so one Escape closes one overlay.
- `ui/src/components/TreeMenu.tsx` already draws exactly the graph aesthetic asked for: `LANE_W = 14`, `ROW_H = 36`, an emerald "current" lane plus a 6-colour cycle, a per-row `<svg>` `Rail` with straight lane rails, node circles, and cubic-bezier fork curves.
- `ui/src/util/diff.ts` (`diffLines`, `sideBySide`) and `SplitDiffBlock` already render a before/after pair; the file-history pane needs no new diff renderer.

Constraint that shapes everything below: git's own history simplification. `git log -- <path>` hides commits that did not change the file, which also removes the parent edges between the commits it does show. A graph drawn from raw `%P` would therefore reference commits that are not in the result set.

## Goals / Non-Goals

**Goals:**

- One server round-trip to build the whole graph — no per-commit follow-up requests.
- The lane layout is a pure function over the log entries, unit-tested without rendering.
- The git graph and the conversation tree share one rail implementation, so a change to the look lands in both.
- Renames are followed, and a diff across a rename compares the right blobs.

**Non-Goals:**

- No repo-wide DAG view (the branch chip keeps its flat recent-commits list).
- No blame, no per-hunk authorship, no "restore this version" — the surface stays read-only.
- No incremental/paged loading; the clamped limit is the whole story.
- No caching layer: each open re-queries git, which is fast enough at these limits.

## Decisions

### The log format: record sentinel plus NUL-framed numstat

`--format=%x1e%H%x1f%P%x1f%an%x1f%aI%x1f%s -z --numstat`, on every invocation below.

- `--numstat` yields the per-file added/deleted counts in the same pass. With `-z`, a rename entry emits `added \t deleted \t \0 oldpath \0 newpath \0` instead of the compressed `dir/{a => b}/f` form, and no path is `core.quotePath`-escaped. That is the reason for `-z`.
- `%x1e` (record separator) prefixes each commit header, so the header line and the NUL-framed numstat payload stay separable.

*Parser contract*: split on `\x1e`; a record whose first field is not 40 hex chars is treated as a continuation of the previous record's subject (a subject containing a literal `\x1e` is the only way that happens). A merge commit carries an empty numstat — git shows no diff for merges by default — so it reports zero lines against the path already being asked about.

*Rejected alternative*: two invocations, metadata then numstat — double the latency and a window in which a commit can land between the calls, skewing the join.

### Renames and merges need two different walks, stitched at the rename

Verified against a fixture repo (rename, then a fork, then a merge resolving a conflict in the file):

| Walk | Merge commits | History before a rename |
|---|---|---|
| `git log --follow -- <path>` | **dropped** (both parents survive, the merge itself does not) | followed |
| `git log --full-history -- <path>` | kept, with both parent edges | **stops dead at the rename** |
| `--follow --full-history` | dropped — `--follow` wins | followed |

Git will not give both in one call, so the server stitches:

1. **Pass**: `git log --full-history <rev> -- <path>`, which keeps merges.
2. **Boundary probe**: if that walk stopped on a commit that still has parents, and the limit is not yet spent, run `git log --follow -n 1 <tail-sha> -- <path>`. `--follow`'s numstat is the only place the rename pair is visible: under a pathspec, `--full-history` (with or without `-M`) reports the rename as a plain add, because the source path lies outside the pathspec it was given.
3. If the probe reports a rename, repeat step 1 from the tail's first parent with the *old* path; otherwise stop. Capped at a small number of stitches so a pathological rename chain cannot fan out.

Cost is 2 spawns for the common case (no rename), plus 2 per rename crossed. Each pass is `-n` the remaining budget, so the total entry count still honours the clamp.

*Rejected alternative*: `--follow` alone, accepting that merges never appear. Divergences would still be visible — two commits sharing a parent draw two lanes — but a merge that resolved a conflict *in this file* is exactly the commit someone reading a file's history wants to find, and dropping it would be a silent lie about who wrote the current line.

*Rejected alternative*: `--full-history` alone, truncating at the first rename. That discards "how did this file get here", which is the proposal's stated goal.

*Rejected alternative*: `--parents`, which rewrites parent ids onto the simplified graph — exactly what a lane renderer wants — but git only prints the rewritten list in its own output prefix, never through `%P` in a custom `--format`.

### Parent edges are pruned to the returned set, with a fallback link

`%P` reports true parents, which under any simplification (and across a stitch seam) can name commits absent from the response. The server filters each entry's parent list to ids present in the result. An entry left with no present parent, but which is not the last entry, is linked to the next entry in log order — which is what joins the two sides of a stitch seam, and what keeps a limit-truncated tail connected. Log order is topological, so this never crosses unrelated commits.

### A revision is a commit id or the literal `"worktree"`

`git_file_diff` carries two sides, each `{ rev, path }`:

- `rev` is a commit id matching the existing `/^[0-9a-f]{7,40}$/i` pattern, or the exact string `"worktree"`. The marker is compared literally and never reaches git as a revision, so there is no way to smuggle `HEAD@{…}`, `--upload-pack=…`, or a branch name through it.
- `path` is the file's path *at that revision*, taken from the log entry the row came from — that is what makes a diff across a rename compare the right blobs. Each side's path is independently confined by the same check the file browser uses.

Commit side: `git show <rev>^{commit}:<toplevel-relative-path>`, reusing `gitHeadContent`'s toplevel-prefix computation (paths in `<rev>:<path>` are toplevel-relative, not cwd-relative). `^{commit}` peels tags and, as in `gitShow`, refuses blob and tree ids. A path missing at that revision yields `""` (the same "not in HEAD" error match `gitHeadContent` already uses), so an add reads as all-added.

Worktree side: `readFileForPreview`, which is the existing confinement + 1 MiB + binary check; `not-found` is swallowed to `""` for a deleted file, exactly as `handleGitDiff` does. The commit side gets the same 1 MiB and NUL-byte checks applied after the fact, again mirroring `handleGitDiff`.

Rejected alternative: a server-side `git diff A B -- path` returning a patch. It would be one call instead of two, but the UI already renders side-by-side from two texts, and a patch would need a second renderer plus its own truncation story.

### Lane layout: a sweep over active lanes, newest → oldest

`layoutFileGraph(entries): { rows, laneCount }` — pure, no React:

1. Keep an array of lanes, each holding the commit id that lane is currently waiting for.
2. For each entry newest-first: its lane is the lane waiting for it, or the leftmost free lane if none is (a root of a disjoint segment). Any *other* lane also waiting for this commit converges here — those lanes are recorded on the row as `mergeFrom` and freed.
3. The entry's first parent inherits the lane. Each additional parent claims the leftmost free lane and is recorded as `forkTo` — drawn with the same downward bezier `TreeMenu` uses, which is visually right: read top-down, a merge commit *does* send a second line of development downward into the past.
4. Lanes waiting for a commit further down pass through the row as `through`, exactly as in `TreeMenu`.

Lane 0 is the newest commit's lane and therefore keeps the emerald "you are here" colour, consistent with the conversation tree's rule that emerald is never worn by a dead branch.

### The rail is extracted, not duplicated

`LANE_W`, `ROW_H`, `CURRENT_COLOR`, `BRANCH_COLORS`, `laneColor` and the `Rail` SVG move to a shared module (`ui/src/components/graph/`). `Rail` takes a row descriptor generalised with an optional `mergeFrom: number[]` (curves arriving from other lanes into this node, mirrored from the `forkTo` path) and an optional `dashed` flag for the working-tree row. `TreeMenu` passes neither and must render byte-identically — its existing tests are the guard.

Rejected alternative: copy the constants into the new component. Two graphs drifting apart is precisely what "joli comme le tree" rules out.

### The working tree is row zero

The working tree is always the first row, above the newest commit, on lane 0, joined to it by a rail segment — dashed when the file is clean, solid when it carries changes (the app already knows this from `git_status`). It is selectable as base or target like any commit. Making it a real row rather than a separate control is what lets "compare this old version to what I have now" be the same gesture as any other comparison.

### Selection is a two-slot state with request-id matching

`base` and `target` are two slots holding `{ rev, path, label }`. Marking a row for a role replaces that slot. Marking the row already in the other slot is rejected (no request fired) rather than producing an empty diff. A swap control exchanges the slots and re-requests. Responses carry both revisions back; a reply whose pair does not match the current selection is dropped — the existing `requestId` plumbing in `useAgent` plus the pair check covers both out-of-order replies and a selection changed mid-flight.

### Entry point and availability

The viewer gains a "history" button next to the existing `± diff` toggle, rendered whenever git is available — not gated on the file having uncommitted changes, since an unmodified file is the common case for "how did this get here?". Clicking opens the full-pane view over the viewer, reusing `GitCommitView`'s overlay and capture-phase Escape handling so one Escape closes one layer.

## UI / UX design

The visual identity is not open for invention here — the brief is "joli comme le tree avec les forks", so the conversation tree's language wins on every axis it already covers. What follows is the part it does not cover: hierarchy inside the pane, the selection interaction, and the words.

### Tokens inherited, not invented

| Role | Value | Source |
|---|---|---|
| Current lane | `#10b981` emerald | `TreeMenu` — reserved for lane 0, never a dead branch |
| Branch lanes | `#8b5cf6 #f59e0b #0ea5e9 #f43f5e #14b8a6 #d946ef` | `TreeMenu`, same cycle order |
| Rail geometry | `LANE_W 14`, `ROW_H 36`, node `r 4`, current node `r 6` ring + `r 2.5` core | `TreeMenu` |
| Commit id | `text-amber-600 / dark:text-amber-500`, mono | `GitMenu`, `GitCommitView` |
| Surfaces, text, borders | zinc scale, `bg-white / dark:bg-zinc-950` | app-wide |
| Diff added / deleted | emerald / red tint pair | `GitCommitView`, `SplitDiffBlock` |

Two roles need colour and must not take a lane hue, or a selected row would read as a branch: **base and target are drawn in neutral zinc with shape, not hue.** That constraint is what produces the signature below.

### Signature: the comparison bracket

A dedicated gutter column sits left of the rail. When both a base and a target are chosen, a bracket is drawn in that gutter spanning the two rows, capped at each end, labelled `base` at one cap and `target` at the other. The span you are diffing is a *shape on the timeline*, not two badges you have to hunt for in a list of forty rows — and it reads directly off the graph metaphor the pane is already built on. It is drawn in zinc-400 / zinc-500 so it sits behind the coloured lanes rather than competing with them.

That bracket is the one bold move. Everything else in the pane is deliberately quiet: no row entrance animations, no gradients, no elevation beyond the overlay itself.

### Layout

```
┌ server/src/git.ts · history ─────────────────────── swap ⇄ ── clear ── ✕ ┐
├──────────────────────────────────────┬───────────────────────────────────┤
│ ┌base                                │  ec14650 → working tree           │
│ │  ┆ ○ working tree      +12 −3       │  ──────────────────────────────── │
│ │  ┆ │                                │   12 │ const x = 1  ┃ const x = 2 │
│ │  ┆ ● 1334634  fix(ui): lay out…     │   13 │              ┃ + added     │
│ │  ┆ │           laurent · 2h  +9 −2  │   14 │ - gone       ┃             │
│ └target                               │                                   │
│    ┆ ●─┐ ec14650  Test wiring…        │                                   │
│    ┆ │ ●  a1b2c3d  wip on branch      │                                   │
│    ┆ ●─┘ 2edae85  chore(release)      │                                   │
└──────────────────────────────────────┴───────────────────────────────────┘
  ↑gutter ↑rail   ↑commit                ↑ diff, or the empty-state prompt
```

Split pane inside the existing full-pane overlay: history on the left at `26rem` (matching `GitMenu`'s dropdown width, so the two git surfaces feel the same size), diff filling the rest. Below `768px` the diff stacks under the history and the history caps at 40% height — the graph stays visible while you scan the diff, because the graph is how you change the diff.

Row anatomy, left to right: bracket gutter (`1.25rem`) · rail SVG · short id (mono, amber) · subject (truncated, zinc-800/200) · author · relative date · `+n −n` counts (emerald / red, mono, right-aligned so they form a scannable column). The counts are the one piece of data that earns a fixed column: they are how you find the commit that actually did something.

### Interaction

- **Click a row** → sets it as target and, if no base is set, sets the base to that row's first parent. One click gives you the useful diff ("what did this commit do to this file?"), which is the common case; the two-point selection is there when you want it, not a toll on the way in.
- **Row hover / focus** reveals two ghost buttons, styled like `TreeMenu`'s `ACTION_CLASS` (`opacity-0 group-hover:opacity-100 focus-visible:opacity-100`): `base` and `target`. Setting a role replaces that slot.
- **Choosing the row already in the other slot** does nothing and the button is `aria-disabled` — you cannot diff a version against itself.
- **Swap ⇄** in the header trades the slots and re-renders in the opposite direction. **Clear** empties both.
- **Keyboard**: `↑`/`↓` move a roving focus through rows, `Enter` applies the click behaviour above, `b` and `t` set base and target on the focused row, `Escape` closes the pane. Focus is visible on every row and control.
- **Motion**: the bracket animates its top and height over `150ms ease-out` when a slot changes — the one orchestrated moment, and it is doing work: it shows you the span changing. Rows never animate. All of it inside a `prefers-reduced-motion: reduce` guard that drops the transition.

### States and copy

Written in the interface's voice: plain verbs, sentence case, no apology, and each string names what the reader controls.

| State | What shows |
|---|---|
| Loading history | `Reading history…` on the list side, diff side blank |
| No commits | `No commits touch this file yet.` — for an untracked or brand-new file |
| Nothing selected | Diff side reads `Pick a commit to see what changed.` |
| One slot filled | Diff side reads `Now pick the version to compare it against.` |
| Diff loading | `Loading…` in the diff header, previous diff dimmed rather than cleared, so the pane does not flash |
| Side too large / binary | The git error verbatim in the diff pane; the history list stays live so you can pick another pair |
| Identical content | `These two versions are identical.` — not an empty diff area, which reads as a bug |
| git unavailable | The affordance is never rendered; there is no dead button to explain |

Labels use the words the pane is about: `base` and `target`, not "from"/"to" (which invert confusingly when you swap) and not "left"/"right" (which are wrong the moment the layout stacks). The header states the pair as `ec14650 → working tree`, using the same short id and the same arrow direction as the bracket, so the two never disagree.

### Accessibility floor

The rail SVG is `aria-hidden` — it carries no information the row text does not, exactly as in `TreeMenu`. Rows are real buttons in a list with an accessible name combining short id and subject. The `+n −n` counts get an `aria-label` spelling out `9 lines added, 2 removed`, since bare signs do not read aloud usefully. Colour is never the only carrier: base and target are named in text on the bracket caps, and the diff sides keep the `+`/`−` glyphs `SplitDiffBlock` already renders.

## Risks / Trade-offs

- **`--full-history` shows merges that changed nothing in the file.** A repo that merges often will put rows in the list whose `+0 −0` counts say they did nothing. → The counts column makes those rows visibly inert, which is also the honest reading: the merge is part of how the file got here even when it contributed no line.
- **The fallback parent link is a heuristic.** If log order were ever non-topological the rail would connect two commits that are not parent and child. → It only ever *adds* an edge between adjacent rows, so the worst case is a visually plausible but slightly wrong rail, never a crash or a wrong diff; diffs are computed from explicit revisions, never from the rail.
- **`--follow`'s rename detection is a heuristic**, and it is what the boundary probe relies on. A rename that came with heavy edits can go undetected, truncating the history there. → Same behaviour as the CLI, and the truncation is silent in git too; not worth diverging from.
- **Stitching multiplies spawns.** Each rename crossed costs two more `git log` calls. → Capped at a small stitch count, each pass bounded by the remaining entry budget and the existing 10 s `runGit` timeout.
- **A subject containing `\x1e` corrupts one record.** → The parser's "not a 40-hex sha ⇒ continuation" rule absorbs it into the subject instead of dropping the commit.
- **Extracting the rail touches the conversation tree.** → Pure move of constants and one component with an additive prop; `TreeMenu`'s tests must pass unchanged, and that is the acceptance condition for the extraction task.
- **The bracket assumes base and target are both visible rows.** Selecting a pair then scrolling far away leaves the bracket off-screen with no cue. → The header always states the pair in text, so the bracket is a locator, never the only readout.
- **Two `git show` calls per selection.** At 1 MiB caps and local disk this is milliseconds; the 10 s `runGit` timeout still bounds the worst case.

## Migration Plan

Additive: two new protocol messages, two new server helpers, one new component, one internal extraction. No stored state, no schema, no config. An older UI against a newer server simply never sends the new requests; the reverse is not a concern since both ship in one binary. Rollback is deleting the feature — nothing else reads what it writes.
