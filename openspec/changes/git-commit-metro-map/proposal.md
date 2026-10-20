# A metro map in the branch chip's commit history

## Why

The branch chip opens a flat list of the checked-out branch's last commits. It says
nothing about the shape of the history: which commits came in through a merge, which
branches exist beside the one checked out, where they leave and rejoin it. The
conversation tree and a file's history already draw that shape as parallel coloured
lines; the repository's own history, where it matters most, is the one view without it.

## What Changes

- `git_log` lists HEAD and every local branch, newest first in date order, instead of
  HEAD alone.
- Each entry carries its parents (pruned to the commits in the same response, and
  rewritten past the commits the browser-root pathspec hides), the local branches whose
  tip it is, the tags on it, and whether it is the newest listed commit on HEAD.
- The chip's menu draws the commits as a metro map with the rail the other two graphs
  use: the checked-out line runs on the first lane in the reserved emerald, other
  branches on lanes of their own, merges and forks as curves, branch names beside their
  tips and tag names beside their commits.
- The map follows the repository while it stays open: a commit or a branch made in a
  terminal redraws it on the server's `git_changed`, where the flat list waited to be
  reopened.

## Impact

- `shared`: `GitCommitLogEntry`; `git_log` carries it.
- `server`: `gitLog` asks `git log --parents --date-order --decorate-refs=refs/heads --decorate-refs=refs/tags HEAD --branches -- .`,
  plus `git log -1 HEAD -- .` for HEAD. Both read-only, under the existing pathspec.
- `ui`: `graph/commitGraph.ts` lays the lanes out; the lane sweep moves there from
  `fileGraph.ts`, which now calls it. `GitMenu` renders the rail; `useAgent` asks for the held log again on `git_changed`.
