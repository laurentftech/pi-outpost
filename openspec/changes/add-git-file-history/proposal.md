## Why

Today the git UI answers "what changed in the repo lately?" (branch chip → last N commits → one commit's whole patch) and "what did I change in this file since HEAD?" (viewer diff toggle). It cannot answer the two questions people actually ask about a file they are reading: *how did this file get here?* and *what does it look like between any two points in its life?* Both are one `git log --follow` / `git diff A B` away on the CLI, but the UI forces a context switch to a terminal — which is exactly what this outpost exists to avoid.

## What Changes

- **Per-file commit history**: a new `git_file_log` request returns the commits touching one file under the browser root — id, author, ISO date, subject, per-file added/deleted line counts, the file's path at that commit (renames followed), and each commit's parent ids so the client can draw the shape of the history.
- **Graph rendering**: a new full-pane `GitFileHistory` view (same overlay pattern as `GitCommitView`) renders that history as a vertical timeline with SVG lanes, so merges and divergences are visible rather than flattened into a list. It wears the conversation tree's visual language — the same lane width, row height, lane palette, node circles and bezier fork curves that `TreeMenu` already draws — so the two graphs in the app read as one idea, not two.
- **Arbitrary two-point diff**: the history rows carry `[base]` / `[target]` selectors, and the working tree is a first-class selectable entry alongside the commits. A new `git_file_diff` request returns the file's content at two revisions (a commit id, or the working tree) so the client renders the existing side-by-side diff between any pair, in either direction.
- **Entry point**: the file viewer gains a "history" affordance next to its existing diff toggle, which opens the full-pane view for the open file.
- No new git subcommands beyond the read-only set already permitted; no mutation, no fetch, no checkout.

## Capabilities

### New Capabilities

None — this extends the existing git integration rather than introducing a separate concern.

### Modified Capabilities

- `git`: adds two requirements — `FileCommitHistory` (per-file log with parents, rename following, and per-file line counts) and `RevisionPairDiff` (content of a file at two selectable revisions, where one may be the working tree). Extends `ConfinedGitCommands` (the new requests take a path *and* one or two revisions, both of which must be validated) and `GitUISurface` (the file-history full-pane view and its viewer entry point).

## Impact

- `server/src/git.ts` — two new read-only helpers (`gitFileLog`, `gitFileRevisionContent`) built on `git log --follow --numstat` and `git show <rev>:<path>`, reusing `runGit`, the existing confinement (`cwd` at browser root, fixed argv, no shell) and the commit-id pattern.
- `shared/src/protocol.ts` — two client requests (`git_file_log`, `git_file_diff`) and their two server responses; a `GitFileLogEntry` type extending the existing `GitLogEntry` shape.
- `server/src/index.ts` — two handlers in `handleClientMessage`, alongside the existing git ones, sharing their path-confinement and `git_error` reply path.
- `ui/src/useAgent.ts` — request/response plumbing and state for the file log and the revision-pair diff.
- `ui/src/components/GitFileHistory.tsx` (new), `ui/src/components/FileViewer.tsx` (history affordance). The lane geometry is computed in a pure helper so it is unit-testable without rendering.
- `ui/src/components/TreeMenu.tsx` — its lane palette, rail geometry constants and `Rail` drawing move to a shared module the two graphs import, so the conversation tree keeps rendering exactly as it does today while the git graph inherits the same look. No behavior change to the conversation tree.
- No new runtime dependencies; the SVG lanes are hand-drawn, not a graph library.
- Size caps: the per-file log limit is clamped like `git_log`, and each diff side obeys the file browser's existing size/binary limits.
