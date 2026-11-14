# Spec Delta

## MODIFIED Requirements

### Requirement: WorkingTreeStatus

The system SHALL report per-file status (modified, added, deleted, untracked, conflicted)
for files under the browser root across every repository in the workspace's repository set,
each file identified by its path relative to the browser root. Alongside the files, the
system SHALL report, for each repository in the set, its current branch and its ahead/behind
counts when a remote is tracked, so that a client can name the branch of any file it has
without a further request.

File status SHALL be gathered from one `git status --porcelain=v2 --branch` invocation per
repository, which collapses a directory holding only untracked files into one entry. Each such
directory SHALL then be listed file by file with a listing that stops after 2,000 files: a
directory holding at most that many is reported file by file, as before; a larger one SHALL be
reported as one entry for the directory, saying it holds at least 2,000 untracked files, so that
neither git, the server nor the client walks, sends or holds every one of them on each refresh.

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

#### Scenario: AHugeUntrackedDirectoryIsOneEntry
- **GIVEN** an unignored directory holding 2,500 untracked files, and a new directory holding 3 in nested folders
- **WHEN** git_status is requested
- **THEN** the large directory is one entry saying it holds at least 2,000 untracked files
- **AND** the 3 files of the small directory are listed one by one

## ADDED Requirements

### Requirement: StatusSentAsChanges

Every git_status answer SHALL carry a version. A client asking again SHALL name the version it holds, and the server SHALL then answer with only the entries added or changed and the paths no longer reported since that version, with the new version. A version the server did not last send to that connection SHALL get the full status.

#### Scenario: ARefreshSendsOnlyWhatChanged
- **GIVEN** a client holding the status of a repository with thousands of changed files
- **WHEN** one more file is modified and the client asks again naming its version
- **THEN** the answer carries that one file and no other entry, and the client's state lists every file as before plus the new one

#### Scenario: AFileNoLongerChangedLeaves
- **GIVEN** a client holding a status that lists a modified file
- **WHEN** the file is restored and the client asks again naming its version
- **THEN** the answer names that path as removed, and the client no longer badges it

#### Scenario: AStrangerVersionGetsEverything
- **WHEN** a client asks naming a version the server did not last send to its connection — after a reconnect, or a project switch
- **THEN** the answer is the full status

### Requirement: StaleChangesRefetched

A client receiving changes against a version it does not hold SHALL drop them and ask again for the full status.

#### Scenario: ChangesAgainstAnotherVersionAreDropped
- **GIVEN** a client holding version 3
- **WHEN** it receives changes based on version 2
- **THEN** its state is unchanged and it asks for the full status

### Requirement: CollapsedUntrackedDirectoryBadge

The file tree SHALL badge a directory reported as holding at least N untracked files with that number followed by "+", count it in its parents' badges the same way, and the Outcome's changed files SHALL list it as one entry naming the directory and that count.

#### Scenario: TheBadgeSaysAtLeast
- **GIVEN** a status reporting `vendor` as holding at least 2,000 untracked files, and one modified file at the root
- **THEN** the `vendor` row shows `2000+` and no row under it shows a git badge
- **AND** the Outcome's changed files list `vendor/` once, saying it holds at least 2,000 untracked files, with no diff to open
