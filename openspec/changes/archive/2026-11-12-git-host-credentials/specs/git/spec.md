# Spec Delta

## MODIFIED Requirements

### Requirement: GitFailuresSayWhy

A git command that fails without git writing anything SHALL be reported with the reason the
server knows instead: that it ran past its time limit, naming the limit; that git could not be
started; or that it wrote more than the server reads. A failure git explains SHALL keep git's own
reason: its first `fatal:` or `error:` line, or its last non-empty line when it wrote neither,
so that a progress line such as `Cloning into '…'...` is never reported as the cause.

#### Scenario: ATimedOutCommandNamesItsLimit
- **WHEN** a git command is stopped by the server's time limit
- **THEN** its error names the command and the limit, not a bare failure

#### Scenario: AMissingGitIsNamed
- **WHEN** the git executable cannot be started
- **THEN** the error says git was not found

#### Scenario: GitsOwnWordsAreKept
- **WHEN** git fails and writes a reason
- **THEN** the error is git's reason line

#### Scenario: AProgressLineIsNotTheReason
- **WHEN** git writes a progress line and then a `fatal:` line before failing
- **THEN** the error is the `fatal:` line
