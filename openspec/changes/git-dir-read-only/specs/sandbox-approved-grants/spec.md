# Spec Delta

## ADDED Requirements

### Requirement: TheRepositoryMetadataIsReadOnlyToAConfinedCommand

Where the writable root holds a `.git`, a command of the agent's confined shell SHALL be able to read it and SHALL NOT be able to write it, under every runner, unless a write grant names it or a folder holding it. A `.git` that does not exist when a command starts SHALL NOT be held for that command. `sandbox.gitWritable: true` in the configuration file SHALL leave it writable. The terminal SHALL NOT be held.

#### Scenario: AConfinedCommandCannotWriteTheRepositoryConfiguration
- **GIVEN** a project that is a git repository, and the agent's shell confined by a runner
- **WHEN** a command writes `.git/config` or a file under `.git/hooks`
- **THEN** the write is refused, and `git status`, `git diff` and `git log` still work

#### Scenario: ACommitAsksForAGrant
- **GIVEN** the same project
- **WHEN** the agent runs `git commit` with `run_with_grant` naming `<root>/.git` for write
- **THEN** the user is asked, the dialog says the grant lets the command change what git runs, and once approved the commit is made

#### Scenario: AMissingGitDirectoryIsNotHeld
- **GIVEN** a writable root that is no git repository
- **WHEN** a command runs `git init`, and another then writes `.git/config`
- **THEN** the first runs and creates the repository, and the second's write is refused

#### Scenario: TheCanarySeesAWritableGitDirectory
- **GIVEN** a runner whose policy leaves `<root>/.git` writable while it claims to hold it read-only
- **WHEN** the confinement canary runs
- **THEN** the shell is not shown as confined, naming the write that got through
