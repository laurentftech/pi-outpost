# Proposal: git-integration

## Why

The agent works inside a git repository, but the UI shows no version-control context: you
can't see which files the agent (or you, via the editor) modified, what changed against
HEAD, or what the recent history looks like — you have to leave the app for a terminal.
Surfacing read-only git state closes the review loop right where the changes happen.

## What Changes

- Header shows the current branch (and ahead/behind counts when a remote is tracked).
- File tree badges: modified / added / untracked / deleted markers on files (and a dot on
  ancestor directories), driven by `git status`.
- Viewer: for a file with changes, a "diff" toggle shows its worktree-vs-HEAD diff using the
  existing side-by-side diff rendering.
- History: a panel lists recent commits (subject, author, relative date); clicking one shows
  that commit's diff.
- Everything is **read-only** — no commit/stage/checkout from the UI in this change.
- Feature degrades cleanly: if the browser root is not inside a git repository (or git is
  not installed), the UI shows none of it.

## Capabilities

### New Capabilities

- `git`: read-only git surface — repo detection, status/branch, per-file worktree diff,
  recent history and per-commit diff, all confined to the file-browser root.

### Modified Capabilities

- `model`: `ClientMessage` gains `git_status | git_diff | git_log | git_show`;
  `ServerMessage` gains the corresponding responses and a `git_error`; the session snapshot
  advertises whether git is available.

## Impact

- `shared/src/protocol.ts` — new message variants + snapshot field.
- `server/src/git.ts` (new) — spawns the `git` binary (fixed argument lists, no shell) with
  results mapped to browser-root-relative paths.
- `server/src/index.ts` — WS handler cases + git availability in the snapshot; status
  invalidation piggy-backs on the existing `file_changed` broadcast.
- `web/src/useAgent.ts` — git state + actions; `web/src/components/` — header branch,
  tree badges, viewer diff toggle, history panel (reuses `diff.ts` rendering).
- No new npm dependencies (uses the system `git` binary via `child_process.execFile`).
