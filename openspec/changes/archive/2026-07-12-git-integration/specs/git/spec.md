# Git Specification

## ADDED Requirements

### Requirement: DetectRepository

The system SHALL probe once at startup whether the file-browser root is inside a git work
tree (system `git` binary present and `rev-parse` succeeds), advertise the result in the
session snapshot (`gitAvailable`), and hide all git features in the UI when unavailable.

#### Scenario: InsideRepository
- **WHEN** the server starts with a browser root inside a git work tree
- **THEN** the snapshot carries gitAvailable: true and git requests are served

#### Scenario: NoRepository
- **WHEN** the browser root is not inside a git work tree, or git is not installed
- **THEN** the snapshot carries gitAvailable: false
- **AND** the UI renders no git affordances

### Requirement: ConfinedGitCommands

The system SHALL run only read-only git commands (`rev-parse`, `status`, `log`, `show`),
spawned without a shell with fixed argument lists, `cwd` at the browser root and a `-- .`
pathspec so git itself reports nothing outside the browser root, with a timeout and output
cap. Single-file operations MUST validate the path with the same confinement used by the
file browser; commit ids MUST match `/^[0-9a-f]{7,40}$/i`.

#### Scenario: RepoLargerThanRoot
- **WHEN** the repository toplevel is an ancestor of the browser root and git_status is requested
- **THEN** Only entries under the browser root are reported

#### Scenario: PathEscapeRefused
- **WHEN** git_diff is requested for a path resolving outside the browser root
- **THEN** The request fails with a git_error and no git command runs on that path

#### Scenario: MalformedSha
- **WHEN** git_show is requested with a sha not matching the commit-id pattern
- **THEN** The request fails with a git_error and no git command is spawned

### Requirement: WorkingTreeStatus

The system SHALL report the current branch, ahead/behind counts when a remote is tracked,
and per-file status (modified, added, deleted, untracked, conflicted) for files under the
browser root, from a single `git status --porcelain=v2 --branch` invocation.

#### Scenario: StatusReported
- **WHEN** git_status is requested in a repo with a modified and an untracked file
- **THEN** The response lists both files with their status and the current branch

#### Scenario: StatusRefresh
- **WHEN** a file_changed broadcast or agent_end event occurs
- **THEN** The client refetches git_status (coalescing concurrent refetches)
- **AND** tree badges and the header branch reflect the new state

### Requirement: WorktreeFileDiff

The system SHALL provide, for a file under the browser root, its HEAD content and its
current disk content so the client can render a side-by-side diff; an untracked file has
empty HEAD content and a deleted file has empty disk content. Both sides obey the file
browser's size and binary limits.

#### Scenario: ModifiedFileDiff
- **WHEN** git_diff is requested for a modified tracked file
- **THEN** The response carries the HEAD version and the worktree version
- **AND** the viewer renders them side-by-side (before | after)

#### Scenario: UntrackedFileDiff
- **WHEN** git_diff is requested for an untracked file
- **THEN** The response carries an empty before and the worktree content as after

### Requirement: CommitHistory

The system SHALL list recent commits touching the browser root (id, author, ISO date,
subject; limit clamped to [1, 100]) and return a given commit's unified patch scoped to the
browser root, capped in size with an explicit truncation flag.

#### Scenario: LogListed
- **WHEN** git_log is requested with limit 20
- **THEN** Up to 20 commits touching the browser root are returned, newest first

#### Scenario: CommitDiffShown
- **WHEN** git_show is requested for a listed commit
- **THEN** Its patch (scoped to the browser root) is returned and rendered as a diff

#### Scenario: OversizedPatchTruncated
- **WHEN** a commit's patch exceeds the size cap
- **THEN** The patch is truncated and flagged truncated: true instead of failing

### Requirement: GitUISurface

The frontend SHALL show the branch (with ahead/behind) as a header chip when git is
available, mark files carrying a status with a colored badge in the file tree (and a dot on
collapsed ancestor directories), offer a worktree diff toggle in the viewer for files with
changes, and open commit history from the branch chip (click a commit → its patch full-pane).

#### Scenario: BranchChipVisible
- **WHEN** the app connects to a server with gitAvailable: true
- **THEN** The header shows the current branch chip

#### Scenario: TreeBadges
- **WHEN** the status lists a modified file inside an expanded directory
- **THEN** The file row shows an "M" badge and collapsed ancestors show a change dot

#### Scenario: ViewerDiffToggle
- **WHEN** a file present in the git status is open in the viewer
- **THEN** A "diff" toggle shows its before/after against HEAD
