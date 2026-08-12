## ADDED Requirements

### Requirement: FileCommitHistory

The system SHALL list the commits touching a single file under the browser root, newest
first, following renames across the file's life. Each entry SHALL carry the commit id,
author, ISO date, subject, the parent commit ids, the file's path at that commit, and the
number of lines added and deleted in that file by that commit. The limit SHALL be clamped
to [1, 200]. A file with no commits (untracked, or newly added) SHALL yield an empty list
rather than an error.

#### Scenario: FileLogListed
- **WHEN** the file history is requested for a tracked file with three commits behind it
- **THEN** the three commits are returned newest first
- **AND** each carries its id, author, ISO date, subject, parent ids, path at that commit, and its added/deleted line counts for that file

#### Scenario: RenameFollowed
- **WHEN** the file history is requested for a file that was renamed two commits ago
- **THEN** commits from before the rename are included
- **AND** each such entry reports the path the file had at that commit

#### Scenario: MergeParentsReported
- **WHEN** the history contains a merge commit that touched the file
- **THEN** that entry lists more than one parent id

#### Scenario: UntrackedFileHistory
- **WHEN** the file history is requested for an untracked file
- **THEN** an empty commit list is returned and no error is raised

#### Scenario: FileLogPathEscapeRefused
- **WHEN** the file history is requested for a path resolving outside the browser root
- **THEN** the request fails with a git_error and no git command runs on that path

### Requirement: RevisionPairDiff

The system SHALL return the content of one file at two requested revisions so the client
can render a diff between them. A revision SHALL be either a commit id matching the
commit-id pattern or the literal working-tree marker. A revision at which the file does not
exist SHALL yield empty content, not an error — so an add reads as an all-added diff and a
delete as an all-deleted one. Both sides SHALL obey the file browser's existing size and
binary limits, and the response SHALL identify which revision each side came from so the
client can label the diff and detect a stale reply.

#### Scenario: CommitToCommitDiff
- **WHEN** content is requested for a file at two different commits
- **THEN** the response carries the file's content at each, tagged with its revision

#### Scenario: CommitToWorktreeDiff
- **WHEN** content is requested with one side a commit and the other the working tree
- **THEN** the commit side carries that commit's content and the other carries the file's current disk content

#### Scenario: ReversedPair
- **WHEN** the same two revisions are requested in the opposite order
- **THEN** the two sides are swapped, so the client renders the diff in the opposite direction

#### Scenario: FileAbsentAtRevision
- **WHEN** one requested revision predates the file's first commit
- **THEN** that side is empty and the request succeeds

#### Scenario: MalformedRevision
- **WHEN** a revision is neither the working-tree marker nor a valid commit id
- **THEN** the request fails with a git_error and no git command is spawned

#### Scenario: BinaryOrOversizedSide
- **WHEN** either side exceeds the file browser's size limit or is detected as binary
- **THEN** the request fails with a git_error rather than returning unusable content

### Requirement: FileHistoryGraph

The frontend SHALL open a full-pane file-history view for the file in the viewer, showing
the file's commits as a vertical timeline whose rail draws one lane per line of development:
a node per commit, a rail continuing between a commit and its parents, and curves where the
history forks or merges. The view SHALL use the same lane geometry, lane palette and node
shapes as the conversation tree graph, so the two read as one visual language. Each row
SHALL show the short commit id, subject, author, relative date and the commit's added and
deleted line counts for that file. The view SHALL close on Escape without also closing the
viewer beneath it, matching the commit-diff pane.

#### Scenario: HistoryOpenedFromViewer
- **WHEN** a tracked file is open in the viewer and its history affordance is used
- **THEN** the full-pane history view opens for that file and its commits are listed newest first

#### Scenario: LinearHistoryRail
- **WHEN** the file's history is linear
- **THEN** every commit sits on one lane joined by a continuous rail

#### Scenario: BranchedHistoryRail
- **WHEN** the file's history contains a merge commit
- **THEN** the merge row shows a curve joining the additional lane back into the rail
- **AND** the commits reached only through that second parent are drawn on their own colored lane

#### Scenario: HistoryEscapeCloses
- **WHEN** Escape is pressed with the history view open over the file viewer
- **THEN** the history view closes and the file viewer stays open

#### Scenario: HistoryUnavailableWithoutGit
- **WHEN** the session reports gitAvailable: false
- **THEN** no history affordance is rendered

### Requirement: RevisionPairSelection

The file-history view SHALL let the user pick any two of the listed revisions as the diff's
base and target, where the working tree is a selectable entry alongside the commits, and
SHALL render the resulting before/after diff in the same pane. The current selection SHALL
be visible on the rows themselves, selecting a base or target SHALL replace the previous one
of that role rather than accumulating, and the pair SHALL be swappable in place and clearable. Choosing the
same revision for both roles SHALL be prevented rather than producing an empty diff. Selecting
a row without naming a role SHALL make it the target and, when no base is set, take its first
parent as the base — so one action yields the commit's own effect on the file. Both roles SHALL
be reachable from the keyboard, and the pane SHALL state which two revisions the displayed
diff belongs to.

#### Scenario: SingleClickShowsCommitEffect
- **WHEN** a commit row is selected with no role named and no base yet chosen
- **THEN** that commit becomes the target and its first parent becomes the base
- **AND** the pane shows what that commit did to the file

#### Scenario: SelectionCleared
- **WHEN** a pair is selected and the selection is cleared
- **THEN** both roles are empty and the pane prompts for a commit instead of showing a stale diff

#### Scenario: IdenticalRevisions
- **WHEN** the two selected revisions hold identical content for the file
- **THEN** the pane says so explicitly rather than rendering an empty diff area

#### Scenario: KeyboardSelection
- **WHEN** a row is focused via the keyboard and a role is applied via the keyboard
- **THEN** that row takes the role, with the same result as using the pointer

#### Scenario: TwoCommitsCompared
- **WHEN** one commit is marked base and another marked target
- **THEN** the pane shows the diff of the file between them, labelled with both short commit ids

#### Scenario: WorktreeAsTarget
- **WHEN** a commit is marked base and the working-tree entry is marked target
- **THEN** the pane shows that commit's version against the file's current disk content

#### Scenario: SelectionReplaced
- **WHEN** a base is already selected and another row is marked base
- **THEN** the earlier base is cleared and only the new one stays marked

#### Scenario: PairSwapped
- **WHEN** a base and target are selected and the pair is swapped
- **THEN** the two roles trade rows and the diff is re-rendered in the opposite direction

#### Scenario: SameRevisionBothSides
- **WHEN** the row already selected as base is chosen as target
- **THEN** the selection is not accepted as a pair and no diff request is made

#### Scenario: DiffRequestFailed
- **WHEN** the content request for a selected pair fails (oversized, binary, or a git error)
- **THEN** the pane shows the error message and keeps the history list usable

## MODIFIED Requirements

### Requirement: ConfinedGitCommands

The system SHALL run only read-only git commands (`rev-parse`, `status`, `log`, `show`),
spawned without a shell with fixed argument lists, `cwd` at the browser root and a pathspec
that is either `-- .` (repo-scoped requests) or the single confined file being asked about
(file-scoped requests), so git itself reports nothing outside the browser root, with a
timeout and output cap. Single-file operations MUST validate the path with the same
confinement used by the file browser; commit ids MUST match `/^[0-9a-f]{7,40}$/i`, and a
revision naming the working tree MUST be an exact literal marker, never passed to git as a
revision. A path MUST NOT be interpretable as an option or a revision by git: file-scoped
commands MUST separate paths from revisions with `--`.

#### Scenario: RepoLargerThanRoot
- **WHEN** the repository toplevel is an ancestor of the browser root and git_status is requested
- **THEN** Only entries under the browser root are reported

#### Scenario: PathEscapeRefused
- **WHEN** git_diff is requested for a path resolving outside the browser root
- **THEN** The request fails with a git_error and no git command runs on that path

#### Scenario: MalformedSha
- **WHEN** git_show is requested with a sha not matching the commit-id pattern
- **THEN** The request fails with a git_error and no git command is spawned

#### Scenario: PathLookingLikeOption
- **WHEN** a file-scoped git request is made for a confined path beginning with a dash
- **THEN** git treats it as a path, not as an option, and the request either succeeds or fails as a path

### Requirement: GitUISurface

The frontend SHALL show the branch (with ahead/behind) as a header chip when git is
available, mark files carrying a status with a colored badge in the file tree (and a dot on
collapsed ancestor directories), offer a worktree diff toggle in the viewer for files with
changes, offer a history affordance in the viewer for any tracked file — not only changed
ones — that opens the file-history graph, and open commit history from the branch chip
(click a commit → its patch full-pane).

#### Scenario: BranchChipVisible
- **WHEN** the app connects to a server with gitAvailable: true
- **THEN** The header shows the current branch chip

#### Scenario: TreeBadges
- **WHEN** the status lists a modified file inside an expanded directory
- **THEN** The file row shows an "M" badge and collapsed ancestors show a change dot

#### Scenario: ViewerDiffToggle
- **WHEN** a file present in the git status is open in the viewer
- **THEN** A "diff" toggle shows its before/after against HEAD

#### Scenario: ViewerHistoryAffordance
- **WHEN** an unmodified tracked file is open in the viewer
- **THEN** no diff toggle is offered but the history affordance is
