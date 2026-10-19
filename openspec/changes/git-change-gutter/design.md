# Design

## Line diff

The gutter marks whole lines. `@codemirror/merge` builds its chunks from a character
diff, which counts deleting the last line as a change of the line before it (the line
break it removes ends that line). Each distinct line is given one character, and the
package's `diff` runs on those strings: its Myers diff then works line by line. The
project's own `diffLines` was not usable: past 300×300 lines between the first and the
last difference it marks the whole middle as changed, so two edits far apart would
paint everything between them.

Past about 63 000 distinct lines (one UTF-16 unit per line, surrogates skipped) the
gutter is not drawn rather than drawn wrong. The file browser's 1 MB limit stays under
that in practice.

## Where HEAD's text comes from

`git_diff` already returns HEAD's text. The gutter asks it with requests prefixed
`gitbase:`, kept in a `gitBaseline` slot apart from `gitDiff`, so the gutter and the
"± diff" pane never overwrite each other. It asks when an open file's status is
modified, added or conflicted, and again on every status re-read, since a commit moves
HEAD; only the latest answer counts. A failure (binary, too large) leaves no gutter and
no error banner: the gutter is an aid, not a feature that can be broken for the user.

## Reference

HEAD, as the "± diff" toggle. VS Code compares with the index, but pi-outpost has no
staging surface, so the index would mean nothing to its user.

## Revert

The revert replaces the hunk's lines with HEAD's, inserted as a CodeMirror `Text` so a
CRLF file keeps CRLF. It is an edit of the draft, with undo, and is only offered where the
draft is editable.

## Following changes made outside

One non-recursive `fs.watch` per repository, on the directory `git rev-parse
--absolute-git-dir` names: `.git` itself, or for a linked work tree or a submodule the
directory its `.git` file points to. Every operation that changes what the status says
writes there — `index`, `HEAD`, `ORIG_HEAD`, `COMMIT_EDITMSG`, `FETCH_HEAD` — so a
non-recursive watch is enough, and costs one handle per repository (capped at 64).
Events are coalesced in a fixed 150 ms window, like the directory watcher's, and announced
as `git_changed { repo }`; the client re-reads that repository's status, and the gutter
follows because it asks for HEAD again on every status.

Our own reads cannot feed it: `runGit` sets `GIT_OPTIONAL_LOCKS=0`, so `git status`
does not rewrite the index. A test proves the watcher would see a status that did.

The watcher belongs to the workspace and follows its repository set: opened at creation
and after a rebuild, re-synced on every rescan, closed on retire and stop. A watched
directory may lie outside the browser root (the repository containing the root, a linked
work tree's git directory); it reads nothing and announces only an id the client already
holds.
