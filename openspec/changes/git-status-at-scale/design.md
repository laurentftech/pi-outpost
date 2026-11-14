# Design

## Context

`gitStatusFor` runs `git status --porcelain=v2 --branch --untracked-files=all` per repository; `handleGitStatus` sends `{ repos, files }` in full; the client rebuilds `gitStatus.files` from it (merging per repository for a scoped answer). The client asks again on `file_changed`, `directory_changed`, `agent_end`, `git_changed`, connection and session changes. `-uall` exists so that files inside a brand-new directory get their own badge.

## Decisions

### Bounded listing instead of `-uall`

`--untracked-files=normal` makes git collapse a directory holding only untracked files into one `dir/` entry, without walking it file by file in the output. For each such entry the server runs `git ls-files --others --exclude-standard -z -- <dir>` and stops reading (killing the process) after 2,000 + 1 paths. At most 2,000: listed file by file, exactly as `-uall` did. More: one entry `{ path: dir, status: "untracked", atLeast: 2000 }`. The threshold is a constant; 2,000 badges is more than a person reads and well under what made the tree slow.

### Deltas keyed by a per-connection version

The server keeps, per connection, the last status it sent (path → entry, and each path's repository) and an opaque version. A request naming that version gets `{ version, base, files: upserts, removed }`; anything else gets the full answer as today (scoped answers stay scoped). The client applies a delta only if `base` is the version it holds; otherwise it drops the delta and asks in full. State that the client resets on its own (project switch, git becoming unavailable) simply has no version, so its next request is full.

### Badges

`dirChangeCount` counts an `atLeast` entry as that many under each ancestor and on the directory itself, and reports the total as at-least when any such entry contributes; the row shows `N+`.

## Risks / Trade-offs

- Files inside a collapsed directory carry no individual badge — the point of collapsing it.
- A delta answer depends on server memory per connection: bounded by what was sent, released on close.
- `git ls-files` per collapsed directory is one more process per such directory; bounded by early termination and only for directories git already found to be wholly untracked.
