# Design: git-integration

## Context

The server already confines a file browser to `BROWSER_ROOT` (sandbox root or agent cwd) and
broadcasts `file_changed` after agent/editor writes. The web app has a diff renderer
(`web/src/diff.ts` + `SplitDiffBlock`) built for the edit-tool cards. The repo the browser
root lives in may be larger than the root itself (sandbox root = subdirectory), and the
browser root may not be a repo at all.

## Goals / Non-Goals

**Goals:**
- Read-only git visibility: branch, per-file status, worktree-vs-HEAD file diff, recent
  history, per-commit diff.
- Confinement: never expose repo content outside `BROWSER_ROOT`, even when the repo's
  toplevel is an ancestor of it.
- Zero new dependencies; clean degradation when git or a repo is absent.

**Non-Goals:**
- No mutations: commit, stage, checkout, branch switch, stash are out of scope.
- No watch/push-based status (no fs watcher; refresh is event- and demand-driven).
- No blame/annotations in the viewer.

## Decisions

1. **System `git` binary via `execFile`** (array args, `shell: false`, `cwd: BROWSER_ROOT`,
   timeout 10s, maxBuffer 10 MiB). Alternatives: isomorphic-git (new dependency, slower,
   partial porcelain) — rejected. Availability probed once at startup with
   `git rev-parse --show-toplevel`; the session snapshot carries `gitAvailable: boolean` and
   the UI renders nothing git-related when false.

2. **Confinement by pathspec `.`** — every command runs with `cwd: BROWSER_ROOT` and a
   trailing `-- .` pathspec (`status --porcelain=v2 --branch -- .`, `log -- .`,
   `show <sha> -- .`). Git itself then only reports entries under the browser root, no
   post-filtering to get wrong. Single-file operations additionally validate the path with
   the existing `resolveConfined` before use.

3. **Status via `--porcelain=v2 --branch`**: one call yields branch name, ahead/behind and
   XY entries (modified/added/deleted/renamed/untracked). Renames map to two entries
   (old = deleted, new = added-from) to keep the wire model flat.

4. **File diff as before/after contents, not a patch.** `git_diff(path)` returns
   `{ before, after }`: before = `git show HEAD:<toplevel-relative-path>` (empty for
   untracked), after = current disk content via `readFileForPreview` (empty for deleted).
   The client feeds both to the existing `diffLines` → `SplitDiffBlock`, so the viewer's
   git diff looks exactly like the edit-tool cards. Both sides obey the 1 MiB / binary
   limits (refused with the existing error reasons).

5. **History as structured log + raw patch per commit.** `git_log` uses
   `log --format=%H%x1f%an%x1f%aI%x1f%s -n <limit> -- .` parsed into entries.
   `git_show <sha>` returns the unified patch (`show --format= --patch <sha> -- .`),
   rendered client-side by a small patch→DiffLine parser (hunk headers become separators).
   Patch output is capped (256 KiB) with a "truncated" flag rather than an error.

6. **Refresh model**: client fetches `git_status` on connect (when `gitAvailable`), after
   every `file_changed`, and on `agent_end` (bash may have touched files git-wise);
   refetches are coalesced (one in flight, trailing rerun). Tree badges and header branch
   both read from that single status state.

7. **Wire additions** (all request/response with `requestId`):
   - `git_status` → `{ branch, ahead, behind, files: [{ path, status }] }` with
     `status: "modified" | "added" | "deleted" | "untracked" | "conflicted"`
   - `git_diff { path }` → `{ path, before, after }`
   - `git_log { limit? }` → `{ entries: [{ sha, author, date, subject }] }`
   - `git_show { sha }` → `{ sha, patch, truncated }`
   - failures → `git_error { requestId, message }`
   - `SessionSnapshot.gitAvailable?: boolean`
   - sha validated `/^[0-9a-f]{7,40}$/i`, limit clamped to [1, 100].

8. **UI placement**: branch chip in the header next to the session controls (with ↑n↓m when
   ahead/behind); status badges as a colored letter suffix in `FileTree` rows (M amber,
   A/U green — untracked shown as green "U", D red, C purple) plus a dot on collapsed
   ancestors; "history" opens from the branch chip as a dropdown listing commits, click →
   full-pane patch view (reuses the viewer overlay slot); in the file viewer, a "diff"
   toggle appears when the open file is in the status list.

## Risks / Trade-offs

- [Repo bigger than browser root: `HEAD:<path>` needs the toplevel-relative path] →
  compute `path.relative(toplevel, resolved)` once per call; covered by a test with
  writableRoot-style nested sandbox.
- [Large repos make `status` slow] → pathspec limits the walk; refetches coalesced; no
  polling.
- [`git show HEAD:` on a file that only exists in the worktree errors] → treated as empty
  "before" (untracked file), not an error.
- [Patch parser meets exotic output (binary files, mode changes)] → lines that aren't
  `+`/`-`/` `/`@@` render as context; binary file diffs show git's own "Binary files differ"
  line.
- [User has no git in PATH] → probe fails → `gitAvailable: false`, feature invisible.

## Migration Plan

Additive protocol + new server module; no config changes. Rollback = revert commit.

## Open Questions

- None blocking.
