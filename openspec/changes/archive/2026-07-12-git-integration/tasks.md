# Tasks: git-integration

## 1. Wire protocol

- [x] 1.1 Add `gitAvailable?: boolean` to `SessionSnapshot` in `shared/src/protocol.ts`
- [x] 1.2 Add ClientMessage variants `git_status | git_log {limit?} | git_diff {path} | git_show {sha}` (all with requestId) and types `GitFileStatus`, `GitLogEntry`
- [x] 1.3 Add ServerMessage variants `git_status {branch, ahead, behind, files}`, `git_diff {path, before, after}`, `git_log {entries}`, `git_show {sha, patch, truncated}`, `git_error {requestId, message}`

## 2. Server git module

- [x] 2.1 Create `server/src/git.ts`: `probeGit(root)` (rev-parse → {toplevel} | null), `runGit` helper (execFile, no shell, cwd=root, timeout 10s, maxBuffer 10 MiB)
- [x] 2.2 `gitStatus(root)`: `status --porcelain=v2 --branch -- .` parsed to branch/ahead/behind + entries (XY → modified/added/deleted/untracked/conflicted; renames → deleted+added)
- [x] 2.3 `gitFileDiff(root, toplevel, relPath)`: resolveConfined the path, before = `show HEAD:<toplevel-relative>` (missing in HEAD → ""), after = disk content (missing → ""); enforce 1 MiB/binary limits with file-browser-style errors
- [x] 2.4 `gitLog(root, limit)`: `log --format=%H%x1f%an%x1f%aI%x1f%s -n <limit> -- .` parsed to entries; `gitShow(root, sha)`: validate sha, `show --format= --patch <sha> -- .`, cap 256 KiB with truncated flag
- [x] 2.5 Wire into `server/src/index.ts`: startup probe → `gitAvailable` in snapshot; WS cases git_status/git_diff/git_log/git_show with field type checks, answering git_error on failure
- [x] 2.6 WS test script: status in nested-root sandbox (repo toplevel above browser root — outside entries invisible), diff modified/untracked, path escape refused, bad sha refused, log+show round-trip, non-repo root → gitAvailable false

## 3. Frontend state

- [x] 3.1 `useAgent.ts`: `gitAvailable` from snapshot; `gitStatus` state (branch/ahead/behind/files map); reducer cases for the four responses + git_error surfaced as error banner
- [x] 3.2 Actions `fetchGitStatus/fetchGitDiff/fetchGitLog/fetchGitShow` (requestId-based, status refetch coalesced: one in flight + trailing rerun)
- [x] 3.3 Auto-refresh: refetch git_status on connect (when available), on `file_changed`, and on `agent_end`

## 4. UI

- [x] 4.1 Header: branch chip (⎇ name, ↑n↓m when nonzero) visible when gitAvailable; click opens history dropdown (uses fetchGitLog)
- [x] 4.2 `FileTree`: status badge per file (M amber, A/U green, D red, C purple) from the status map; change dot on collapsed directories containing changes
- [x] 4.3 Viewer: "diff" toggle when the open file has a git status — renders before/after via existing `diffLines` + `SplitDiffBlock`; untracked = all additions
- [x] 4.4 History: commit list (subject, author, relative date) in the dropdown; click → full-pane patch view over the chat (parse unified patch → DiffLine rows, hunk headers as separators; "truncated" notice when flagged); Esc/✕ closes
- [x] 4.5 Hide everything when `gitAvailable` is false

## 5. Verification

- [x] 5.1 Browser E2E: badges appear after an edit, viewer diff for modified + untracked files, history list → commit patch, branch chip counts
- [x] 5.2 Typecheck all workspaces + `npm run build --workspaces --if-present`
- [x] 5.3 Code review agent pass; fix blocking findings
