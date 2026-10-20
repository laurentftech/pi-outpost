# Design

## Which commits

`HEAD --branches`: the checked-out line and every local branch. Remote-tracking branches
are left out — a repository with many remotes would fill a hundred commits with lines
the user never touches locally. Tags are shown, but as names on a commit, never as lines: a tag marks a commit
already on a line, and its name is drawn square where a branch's is round.

## Parents under a pathspec

The log is scoped to the browser root with `-- .`. Path limiting hides commits that
changed nothing there, but `%P` keeps naming them unless parent rewriting is on;
`--parents` turns it on, so a merge whose side branch's tip only touched files outside
the root points at the nearest commit that is listed. A parent cut off by the limit is
then dropped rather than kept pointing at nothing: the bottom of the list is the end of
what is drawn, not a line running off into commits the client does not have.

## Lanes

The lane sweep is the one `fileGraph.ts` already had (a commit takes the lane waiting
for it, other lanes waiting for it converge, its first parent inherits the lane, extra
parents claim free lanes). It moves to `commitGraph.ts` and both graphs call it.

What the repository map adds: lane 0 is reserved, before the sweep starts, for HEAD's
commit. HEAD's first-parent chain therefore always runs on lane 0 and wears the emerald
`laneColor` reserves for "you are here", whatever the date order puts above it. Until
HEAD's commit is reached the reserved lane draws nothing, so branches newer than HEAD
do not sit beside an emerald line that has not started yet. A commit no lane was waiting
for is a branch tip, and its rail starts at its node.
