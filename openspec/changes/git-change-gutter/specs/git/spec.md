## ADDED Requirements

### Requirement: EditorChangeGutter

The file's source view and its editor SHALL mark, beside each line, what differs from the
file's HEAD version: lines added, lines changed, and the place of lines removed, compared
with the text the editor holds as it is edited. The marks SHALL be drawn only for a file
whose git status is modified, added or conflicted, and SHALL be dropped, without an error,
when HEAD's version cannot be compared.

#### Scenario: ChangedLinesAreMarked
- **WHEN** a modified file is opened in which one line was changed, another added and another removed since HEAD
- **THEN** the changed line carries a changed mark, the added line an added mark, and the place of the removed line a removal mark
- **AND** no other line carries a mark

#### Scenario: TheMarksFollowTheDraft
- **WHEN** the user types a new line into the editor, then deletes it
- **THEN** an added mark appears beside it, then disappears, before anything is saved

#### Scenario: TwoDistantEditsStayApart
- **WHEN** a file of two thousand lines has one line changed near its start and one near its end
- **THEN** exactly those two lines are marked

#### Scenario: NoMarksWithoutAComparableHead
- **WHEN** the open file is untracked, or clean, or HEAD's version is refused as binary or too large
- **THEN** no mark is drawn, and no error is shown

#### Scenario: TheGutterFollowsHead
- **WHEN** the file's status is re-read after a commit moved HEAD
- **THEN** the marks compare with the new HEAD, and an answer to an earlier request is ignored

### Requirement: GutterChangePeek

A click on a gutter mark SHALL show HEAD's text for that change under it. An editable
editor SHALL also offer to revert that change into the draft, without saving it; the
read-only source view SHALL NOT.

#### Scenario: AClickShowsHeadsText
- **WHEN** the user clicks a changed mark
- **THEN** HEAD's text of that change is shown under it

#### Scenario: AChangeIsRevertedIntoTheDraft
- **WHEN** the user reverts a change from its mark in the editor
- **THEN** the draft holds HEAD's text for those lines, the mark disappears, and the file on disk is unchanged

#### Scenario: TheSourceViewOffersNoRevert
- **WHEN** the user clicks a mark in the read-only source view
- **THEN** HEAD's text is shown, and no revert is offered

### Requirement: GitStateFollowsOutsideChanges

The server SHALL notice when a repository's own state changes — a commit, checkout,
reset or similar, made by anyone — and SHALL tell the clients of that workspace which
repository changed, so they re-read its status. Its own reading of a repository SHALL NOT
count as a change.

#### Scenario: AnOutsideCommitIsAnnounced
- **WHEN** a commit is made in one of the workspace's repositories from outside the application
- **THEN** the clients are told that repository changed, and re-read its status

#### Scenario: AnOutsideCheckoutMovesTheBranch
- **WHEN** a branch is checked out in a repository from outside the application
- **THEN** the status read after the announcement names the new branch

#### Scenario: ReadingTheStatusIsNotAChange
- **WHEN** the server reads a repository's status, with a modified file whose index entry a writing status would refresh
- **THEN** no change is announced

#### Scenario: ALinkedWorkTreeIsFollowed
- **WHEN** the workspace is a linked work tree, whose git state lives outside it, and a commit is made in it
- **THEN** the change is announced
