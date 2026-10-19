## ADDED Requirements

### Requirement: HeaderControlsShareOneRow

`Header` SHALL keep its controls on one row of one height, none of them wrapping its label.
A label the user does not choose SHALL be cut rather than wrapped, its full text available
on hover. The extensions' statuses SHALL fold into one control listing them in full when
they do not fit the bar, and SHALL return inline once the bar has room for them again.

#### Scenario: EveryControlIsOneHeight
- **WHEN** the header shows a project, a branch, a title, statuses and every optional control
- **THEN** every control in the bar has the same height and a label that does not wrap

#### Scenario: ALongLabelIsCutNotWrapped
- **WHEN** the project's name or the branch is too long for the room left
- **THEN** it is cut with an ellipsis, and its full name is the control's title

#### Scenario: StatusesFoldWhenTheyDoNotFit
- **WHEN** the statuses would be cut or the bar would overflow
- **THEN** they fold into one control naming how many there are, which lists them in full and closes on Escape

#### Scenario: StatusesUnfoldWhenRoomReturns
- **WHEN** the bar grows well past the width at which the statuses folded
- **THEN** they return inline, and a list left open does not reappear at the next fold
