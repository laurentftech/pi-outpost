# Git Specification

## Purpose

Read-only git integration: repository detection, confined git commands, working-tree status,
worktree file diffs, commit history, and the UI surface that exposes them.

## Requirements

### Requirement: DetectRepository

The system SHALL determine, when the workspace is built, which git repositories it holds
(the git executable resolvable and `rev-parse` succeeding): the repository containing the
file-browser root when there is one, and the repositories whose work tree lies under that
root. It SHALL advertise in the session snapshot (`gitAvailable`) whether the workspace
holds at least one repository, and hide all git features in the UI when it holds none.

`gitAvailable` describes the workspace, not any single file: a workspace whose root is not
itself in a repository but which holds repositories underneath SHALL advertise git as
available.

When `gitAvailable` is false the snapshot SHALL also carry why, as described in
SayWhyGitIsUnavailable. Hiding the features and saying nothing about them is what makes a
missing binary indistinguishable from a directory that was never a repository.

#### Scenario: InsideRepository
- **WHEN** the server starts with a browser root inside a git work tree
- **THEN** the snapshot carries gitAvailable: true and git requests are served

#### Scenario: NoRepository
- **WHEN** the browser root is not inside a git work tree, holds no repository underneath, or git is not installed
- **THEN** the snapshot carries gitAvailable: false, with the reason
- **AND** the UI renders no git affordances

#### Scenario: RepositoriesOnlyUnderneath
- **WHEN** the server starts with a browser root that is not inside a git work tree but holds repositories in its child directories
- **THEN** the snapshot carries gitAvailable: true and git requests are served

### Requirement: ConfinedGitCommands

The workspace Git integration SHALL run only read-only git commands (`rev-parse`, `status`, `log`, `show`), spawned without a shell with fixed argument lists, `cwd` at the browser root or at the toplevel of a repository in the workspace's repository set, and a pathspec that is either `-- .` (repo-scoped requests) or the single confined file being asked about (file-scoped requests), so git itself reports nothing outside the browser root, with a timeout and output cap. A repository toplevel SHALL become a `cwd` only after passing the same confinement check the file browser uses, so a repository discovered outside the browser root is never consulted. Single-file operations MUST validate the path with the same confinement used by the file browser; commit ids MUST match `/^[0-9a-f]{7,40}$/i`, and a revision naming the working tree MUST be an exact literal marker, never passed to git as a revision. A path MUST NOT be interpretable as an option or a revision by git: file-scoped commands MUST separate paths from revisions with `--`.

The agent-resource updater is a separate capability and MUST NOT broaden the commands, repository set, path inputs, or mutation authority of workspace Git requests. Its additional commands and trusted resource repositories SHALL be available only through the guarded operations specified by `agent-resource-management`.

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

#### Scenario: RepositoryRootOutsideTheBrowserRootIsNeverACwd
- **WHEN** a candidate repository toplevel resolves outside the browser root
- **THEN** it is excluded from the repository set and no git command is spawned with it as cwd

#### Scenario: Resource updater does not expand workspace Git authority
- **WHEN** a workspace Git request names a resource repository outside the browser root or asks for an update command
- **THEN** the workspace Git integration refuses it exactly as before
- **AND** the request is not rerouted to the resource updater

### Requirement: WorkingTreeStatus

The system SHALL report per-file status (modified, added, deleted, untracked, conflicted)
for files under the browser root across every repository in the workspace's repository set,
each file identified by its path relative to the browser root. Alongside the files, the
system SHALL report, for each repository in the set, its current branch and its ahead/behind
counts when a remote is tracked, so that a client can name the branch of any file it has
without a further request.

File status SHALL be gathered from one `git status --porcelain=v2 --branch` invocation per
repository. A workspace holding one repository SHALL therefore behave exactly as before.

#### Scenario: StatusReported
- **WHEN** git_status is requested in a repo with a modified and an untracked file
- **THEN** The response lists both files with their status and the current branch

#### Scenario: StatusSpansRepositories
- **GIVEN** a workspace holding two repositories, each with a modified file
- **WHEN** git_status is requested
- **THEN** both files are listed, each with a path relative to the browser root
- **AND** both repositories are reported with their own branch and ahead/behind counts

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

The system SHALL list recent commits (id, author, ISO date, subject; limit clamped to
[1, 100]) and return a given commit's unified patch, capped in size with an explicit
truncation flag. Both SHALL be scoped to one repository of the workspace's repository set —
the repository owning the path the request names — and, within it, to the browser root.

A commit id SHALL be interpreted only against the repository the request names a path for;
a request naming a path owned by no repository SHALL fail with a git error rather than
falling back to another repository.

#### Scenario: LogListed
- **WHEN** git_log is requested with limit 20
- **THEN** Up to 20 commits touching the browser root are returned, newest first

#### Scenario: LogIsScopedToTheNamedRepository
- **GIVEN** a workspace holding two repositories with unrelated histories
- **WHEN** the log is requested for a path inside the first
- **THEN** only the first repository's commits are returned

#### Scenario: CommitDiffShown
- **WHEN** git_show is requested for a listed commit
- **THEN** Its patch (scoped to the browser root) is returned and rendered as a diff

#### Scenario: OversizedPatchTruncated
- **WHEN** a commit's patch exceeds the size cap
- **THEN** The patch is truncated and flagged truncated: true instead of failing

#### Scenario: CommitIdFromAnotherRepository
- **GIVEN** a commit id that exists only in the second repository
- **WHEN** its patch is requested against the first
- **THEN** the request fails with a git_error and no patch from either repository is returned

### Requirement: GitUISurface

The frontend SHALL show a branch chip in the header when git is available, mark files
carrying a status with a colored badge in the file tree (and a dot on collapsed ancestor
directories) whichever repository they belong to, offer a worktree diff toggle in the viewer
for files with changes, offer a history affordance in the viewer for any tracked file — not
only changed ones — that opens the file-history graph, and open commit history from the
branch chip (click a commit → its patch full-pane).

The branch chip SHALL name the repository owning what the user last touched in the file
tree — a file or a directory — with that repository's branch and ahead/behind counts, and
the commit history opened from it SHALL be that repository's. Touching anything in another
repository SHALL move the chip to that repository without any picker control: walking into a
project's directory says which project the user is in as surely as opening one of its files,
and SHALL move the chip as surely.

When nothing has been touched, the chip SHALL name the workspace's only repository if it has
exactly one, and SHALL otherwise name no branch while remaining visible. A selection owned by
no repository SHALL likewise name no branch, rather than continuing to name the last
repository it knew — in a directory of projects the loose files at the root are exactly where
a README lives, and a chip naming a project the user has left is worse than one admitting it
has none. A file owned by no repository SHALL additionally offer neither diff toggle nor
history affordance.

#### Scenario: BranchChipVisible
- **WHEN** the app connects to a server with gitAvailable: true
- **THEN** The header shows the current branch chip

#### Scenario: TreeBadges
- **WHEN** the status lists a modified file inside an expanded directory
- **THEN** The file row shows an "M" badge and collapsed ancestors show a change dot

#### Scenario: BadgesSpanRepositories
- **GIVEN** a workspace whose root is not a repository and whose two child directories are
- **WHEN** each holds a modified file and the tree is expanded to show them
- **THEN** both rows carry their badge, and each child directory shows a change dot when collapsed

#### Scenario: TheChipFollowsTheSelection
- **GIVEN** a workspace holding two repositories on different branches
- **WHEN** the user selects a file in the first and then a file in the second
- **THEN** the chip names the first repository's branch, then the second's

#### Scenario: TheChipFollowsADirectoryToo
- **GIVEN** a workspace holding two repositories, with the chip naming the first
- **WHEN** the user clicks the second repository's directory in the tree, opening no file
- **THEN** the chip names the second repository's branch

#### Scenario: ASelectionUnderNoRepositoryNamesNothing
- **GIVEN** a workspace holding two repositories, with the chip naming one of them
- **WHEN** the user selects a file that lies under no repository
- **THEN** the chip remains on screen and names no branch

#### Scenario: FullGitSurfaceOnClickingATrackedLeaf
- **GIVEN** a workspace whose root is not a repository, holding a repository with a modified tracked file
- **WHEN** the user clicks that file in the tree
- **THEN** the chip names its repository's branch, the viewer offers its worktree diff and its history affordance, and the chip's commit history lists that repository's commits

#### Scenario: NoSelectionInAMultiRepositoryWorkspace
- **GIVEN** a workspace holding two repositories and no file selected
- **THEN** the chip is shown and names no branch

#### Scenario: ViewerDiffToggle
- **WHEN** a file present in the git status is open in the viewer
- **THEN** A "diff" toggle shows its before/after against HEAD

#### Scenario: ViewerHistoryAffordance
- **WHEN** an unmodified tracked file is open in the viewer
- **THEN** no diff toggle is offered but the history affordance is

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

### Requirement: ResolveTheRepositoryOwningAPath

The system SHALL own, per workspace, a set of git repositories: the repositories whose
work tree lies under the browser root, together with the repository containing the browser
root when the root is itself inside one. Every git request naming a path SHALL be served by
the repository in that set whose toplevel is the longest prefix of the path; a path owned by
no repository in the set SHALL be treated as untracked — no badge, no diff, no history — and
SHALL NOT fail the request that carried it alongside tracked paths.

Discovery SHALL be bounded so that a large workspace does not stall the server: it SHALL NOT
descend into a repository's work tree looking for further repositories, and SHALL NOT
descend into directories the file browser already excludes. A repository marker that is a
file rather than a directory — as a linked work tree and a submodule both have — SHALL be
recognised as a repository wherever discovery reaches it.

These two rules settle the submodule between them: a submodule of a repository the workspace
already holds is inside that repository's work tree, so discovery stops before it and its
parent answers for its files. A repository nested under the browser root but outside every
repository in the set — an embedded clone, or a submodule of a repository whose toplevel is
an ancestor of the root — is found and answers for itself; the containing repository reports
it as a single entry, and the set SHALL NOT report that entry as a file of its own.

#### Scenario: NestedRepositoriesUnderANonRepositoryRoot
- **GIVEN** a browser root that is not inside a git work tree, holding three child directories that are each a repository
- **WHEN** a client requests the working-tree status
- **THEN** files from all three repositories are reported

#### Scenario: TheLongestPrefixWins
- **GIVEN** a browser root inside a repository, holding a child directory that is its own repository
- **WHEN** a file inside that child directory is asked about
- **THEN** the child repository answers, not the ancestor one

#### Scenario: AFileOwnedByNoRepository
- **GIVEN** a workspace holding one repository and a loose file outside it
- **WHEN** that loose file is opened
- **THEN** no diff toggle and no history affordance are offered for it
- **AND** the status request that listed its siblings still succeeds

#### Scenario: ARepositoryMarkerThatIsAFile
- **GIVEN** a child directory whose repository marker is a file, as a linked work tree and a submodule both have
- **WHEN** the workspace discovers its repositories
- **THEN** that directory is one of them

#### Scenario: ARepositoryInsideAWorkTreeIsLeftToItsParent
- **GIVEN** a browser root that is itself a repository, holding a submodule
- **WHEN** the workspace discovers its repositories
- **THEN** it holds one repository, and the submodule's files are answered by it

#### Scenario: AnEmbeddedRepositoryIsNotAlsoAFile
- **GIVEN** a browser root inside a repository, holding a child directory that is its own repository
- **WHEN** the working-tree status is reported
- **THEN** the child's own files carry their status
- **AND** the containing repository's single entry for that child is not reported as a file

### Requirement: RepositorySetFreshness

The repository set SHALL be re-established when a repository appears under the browser root
or stops being one during the life of the workspace, so that a repository cloned or
initialised while the server runs becomes usable without restarting it, and a removed one
stops being consulted.

#### Scenario: ARepositoryClonedWhileRunning
- **GIVEN** a running workspace whose repositories have already been discovered
- **WHEN** a new repository appears under the browser root
- **THEN** its files carry status badges and its history is available, without a restart

#### Scenario: ARepositoryThatStopsBeingOne
- **GIVEN** a workspace holding two repositories
- **WHEN** one of them ceases to be a repository
- **THEN** its files are reported as owned by no repository
- **AND** no git command is spawned against its former toplevel

### Requirement: LocateTheGitExecutable

The system SHALL resolve the git executable before spawning it, rather than trusting the
process `PATH`. Resolution SHALL try, in order: the path named by configuration when there
is one; `git` as found on `PATH`; and the standard installation locations for the platform.
The first candidate that answers `git --version` SHALL be used for every git command of that
run.

A configured path that cannot be run SHALL fail resolution rather than falling through to
another candidate: an operator who names an executable is stating which one to use, and
silently running a different one would answer questions about the wrong installation.

Resolution SHALL happen once per server run, not once per command.

#### Scenario: GitOnThePath
- **GIVEN** a `PATH` containing a working git
- **WHEN** the system resolves the executable
- **THEN** that git is used

#### Scenario: GitInstalledButNotOnThePath
- **GIVEN** a machine where git is installed in the platform's standard location and absent from `PATH`
- **WHEN** the system resolves the executable
- **THEN** the installed git is found and used
- **AND** git features are available

#### Scenario: ConfiguredPathWins
- **GIVEN** a configuration naming a git executable, and a different git on `PATH`
- **WHEN** the system resolves the executable
- **THEN** the configured one is used

#### Scenario: ConfiguredPathThatCannotRun
- **GIVEN** a configuration naming a path that is not a runnable git
- **WHEN** the system resolves the executable
- **THEN** resolution fails, naming that path
- **AND** no other candidate is tried

#### Scenario: NoGitAnywhere
- **GIVEN** a machine with no git on `PATH` and none in any standard location
- **WHEN** the system resolves the executable
- **THEN** resolution fails, and git is reported unavailable because the executable could not be run

### Requirement: SayWhyGitIsUnavailable

When git is unavailable the system SHALL report which of three things is true, rather than
reporting only that it is: the executable could not be run, the workspace holds no
repository, or git ran and refused.

A workspace SHALL be counted as having git only when a repository it holds actually answers
git. Discovery reads the filesystem, which cannot tell a working repository from one git
declines to open, so a set found on disk SHALL be verified before the features that depend
on it are offered — otherwise every command fails where nobody is watching. Where git itself produced a message — "detected dubious
ownership" is the everyday case — that message SHALL be carried verbatim, because it names
the directory and the remedy.

The reason SHALL travel in the session snapshot beside `gitAvailable`, so a client learns it
without asking a question it has no reason to know to ask.

These are not equally interesting. A directory that holds no repository is the ordinary
state of a directory and SHALL be reported quietly. An executable that cannot be run, or a
repository git refuses, is a setup fault the user can fix and SHALL be surfaced where a user
looks when something is missing.

#### Scenario: NoExecutable
- **GIVEN** a machine where the git executable cannot be resolved
- **WHEN** a client connects
- **THEN** the snapshot says git is unavailable because the executable could not be run

#### Scenario: NoRepositoryHere
- **GIVEN** a workspace whose root holds no repository, on a machine with a working git
- **WHEN** a client connects
- **THEN** the snapshot says git is unavailable because there is no repository
- **AND** the reason is not raised as a fault to be fixed

#### Scenario: ARepositoryOnDiskGitWillNotRead
- **GIVEN** a workspace holding a directory the filesystem says is a repository, which git refuses to read
- **WHEN** a client connects
- **THEN** git is reported unavailable, because git refused
- **AND** the features are not offered as though they worked

#### Scenario: GitRefusesTheRepository
- **GIVEN** a repository git declines to read, as it does for dubious ownership
- **WHEN** a client connects
- **THEN** the snapshot says git is unavailable because git refused
- **AND** git's own message is carried with it

#### Scenario: TheFaultIsVisibleWhereAUserLooks
- **GIVEN** git reported unavailable because its executable could not be run
- **WHEN** the user opens the settings panel
- **THEN** it names git as unavailable, why, and what would fix it

#### Scenario: AnOrdinaryDirectoryIsNotAFault
- **GIVEN** git reported unavailable because the workspace holds no repository
- **WHEN** the user opens the settings panel
- **THEN** it states that plainly and offers nothing to fix

#### Scenario: TheReasonDoesNotOutliveItsCause
- **GIVEN** a workspace reported unavailable because it holds no repository
- **WHEN** a repository appears under it and the set is re-established
- **THEN** git is reported available and no reason is carried
