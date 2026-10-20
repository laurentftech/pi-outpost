## MODIFIED Requirements

### Requirement: CommitHistory

The system SHALL list recent commits (id, author, ISO date, subject; limit clamped to
[1, 100]) and return a given commit's unified patch, capped in size with an explicit
truncation flag. Both SHALL be scoped to one repository of the workspace's repository set —
the repository owning the path the request names — and, within it, to the browser root.

The listed commits SHALL be those reachable from HEAD or from any local branch, newest
first, with every commit listed above its parents. Each entry SHALL carry its parent
commit ids, pruned to the commits listed in the same response and rewritten past commits
hidden by the browser-root scope; the names of the local branches whose tip it is; and
the names of the tags on it, kept apart from the branch names; and whether it is the
newest listed commit reachable from HEAD.

A commit id SHALL be interpreted only against the repository the request names a path for;
a request naming a path owned by no repository SHALL fail with a git error rather than
falling back to another repository.

#### Scenario: LogListed
- **WHEN** git_log is requested with limit 20
- **THEN** Up to 20 commits touching the browser root are returned, newest first

#### Scenario: LogSpansLocalBranches
- **GIVEN** a local branch with commits not merged into HEAD
- **WHEN** the log is requested
- **THEN** that branch's commits are listed, and its tip carries the branch's name
- **AND** exactly one entry, HEAD's commit, is marked as HEAD

#### Scenario: TagsAreNamed
- **GIVEN** a lightweight tag on one listed commit and an annotated tag on another
- **WHEN** the log is requested
- **THEN** each commit carries its tag's name among its tags, not among its branches

#### Scenario: ParentsSkipHiddenCommits
- **GIVEN** a merge whose second parent changed nothing under the browser root, while that parent's own parent did
- **WHEN** the log is requested
- **THEN** the merge's parents are the first-parent commit and the nearest listed commit on the merged branch

#### Scenario: ParentsBeyondTheLimitAreDropped
- **WHEN** the log is requested with a limit that stops before the oldest commit
- **THEN** no entry names a parent that is not itself listed

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

## ADDED Requirements

### Requirement: CommitMetroMap

The branch chip's commit history SHALL draw its commits as a metro map, like the
file-history graph: one lane per line of development, the checked-out line first in the
"you are here" colour, merges as curves, and branch and tag names beside their commits.
Clicking a commit SHALL still open its patch.

#### Scenario: TheCheckedOutLineRunsOnTheFirstLane
- **GIVEN** a log in which another branch's commit is newer than HEAD's
- **WHEN** the history is opened
- **THEN** HEAD's commit and its first parents sit on the first lane in the reserved colour, and the other branch on another lane
- **AND** no line is drawn on the first lane above HEAD's commit

#### Scenario: AMergeJoinsTwoLines
- **WHEN** the history holds a merge commit
- **THEN** a curve leaves the merge towards the lane of its second parent, and that lane converges where it meets the first-parent line

#### Scenario: ABranchTipNamesItsBranch
- **WHEN** a listed commit is the tip of a local branch
- **THEN** its row shows the branch's name, and the checked-out branch's name is told apart from the others
- **AND** a branch tip that no newer commit descends from starts its line at its own node

#### Scenario: ATaggedCommitShowsItsTag
- **WHEN** a listed commit carries a tag
- **THEN** its row shows the tag's name, in a form told apart from a branch name

### Requirement: CommitMetroMapFollowsTheRepository

An open commit map SHALL follow a commit, checkout or branch made in its repository
outside the application, without being reopened.

#### Scenario: TheMapFollowsAnOutsideCommit
- **GIVEN** the history of a repository is open
- **WHEN** a commit or a new branch is made in that repository outside the application
- **THEN** the map is asked for again and redraws with it, without being reopened
