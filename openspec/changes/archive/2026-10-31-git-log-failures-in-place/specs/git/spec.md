## MODIFIED Requirements

### Requirement: CommitMetroMapFollowsTheRepository

An open commit map SHALL follow a commit, checkout or branch made in its repository
outside the application, without being reopened. A closed one SHALL NOT be asked for: closing
the map forgets it, and opening it again asks for it afresh, so a change made while it was closed
is shown the next time it opens.

#### Scenario: TheMapFollowsAnOutsideCommit
- **GIVEN** the history of a repository is open
- **WHEN** a commit or a new branch is made in that repository outside the application
- **THEN** the map is asked for again and redraws with it, without being reopened

#### Scenario: AClosedMapIsNotAskedFor
- **GIVEN** the history of a repository was opened, then closed
- **WHEN** that repository changes outside the application
- **THEN** its commit map is not asked for, and opening the history again asks for it

## ADDED Requirements

### Requirement: CommitMapFailuresStayInTheMap

A commit map that cannot be listed SHALL say so inside the history menu, in place of its
commits, and SHALL NOT add an error to the conversation's error banner: the person did not ask the
conversation anything, and a failure there reads as one of the agent's. The menu SHALL NOT go on
saying it is loading once its request has failed.

#### Scenario: AFailedMapSaysSoInTheMenu
- **GIVEN** the history of a repository is open
- **WHEN** listing its commits fails
- **THEN** the menu shows the failure in place of the commits, no longer says it is loading, and the conversation's error banner is unchanged

### Requirement: GitFailuresSayWhy

A git command that fails without git writing anything SHALL be reported with the reason the
server knows instead: that it ran past its time limit, naming the limit; that git could not be
started; or that it wrote more than the server reads. A failure git explains SHALL keep git's own
first line.

#### Scenario: ATimedOutCommandNamesItsLimit
- **WHEN** a git command is stopped by the server's time limit
- **THEN** its error names the command and the limit, not a bare failure

#### Scenario: AMissingGitIsNamed
- **WHEN** the git executable cannot be started
- **THEN** the error says git was not found

#### Scenario: GitsOwnWordsAreKept
- **WHEN** git fails and writes a reason
- **THEN** the error is git's first line
