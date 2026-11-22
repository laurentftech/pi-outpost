# Spec Delta

## ADDED Requirements

### Requirement: TheRepositoryMetadataIsReadOnlyToAConfinedCommand

Under every runner that can hold it, a confined command SHALL be able to read the repository's `.git` and SHALL NOT be able to write it, unless a grant names `<root>/.git` for write. A runner that cannot hold it SHALL say so at its check, in the startup log and in the shell lock's tooltip. `sandbox.gitWritable: true` in the configuration file SHALL restore a writable `.git`.

#### Scenario: AConfinedCommandCannotWriteTheRepositoryConfiguration
- **GIVEN** a project that is a git repository, and the agent's shell confined by a runner
- **WHEN** a command writes `.git/config` or a file under `.git/hooks`
- **THEN** the write is refused, and `git status`, `git diff` and `git log` still work

#### Scenario: ACommitAsksForAGrant
- **GIVEN** the same project
- **WHEN** the agent runs `git commit` with `run_with_grant` naming `<root>/.git` for write
- **THEN** the user is asked, the dialog says the grant lets the command change what git runs, and once approved the commit is made

#### Scenario: TheCanarySeesAWritableGitDirectory
- **GIVEN** a runner whose policy leaves `<root>/.git` writable while it claims to hold it read-only
- **WHEN** the confinement canary runs
- **THEN** the shell is not shown as confined, naming the write that got through
