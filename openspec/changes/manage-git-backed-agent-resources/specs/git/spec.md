## MODIFIED Requirements

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
