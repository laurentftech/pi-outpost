## ADDED Requirements

### Requirement: SourceMatchesAreDrawnByTheEditor

In the source of a file, read or edited, the find bar's matches SHALL be drawn by the code editor:
every match marked, the current one distinguished, selected and scrolled into view without taking
focus from the find field. A switch between views under the same query SHALL keep the current match.

#### Scenario: CurrentMatchIsSelectedInTheEditor
- **GIVEN** a file open for editing with the find bar showing a current match
- **WHEN** that match becomes current
- **THEN** its exact text is selected in the editor and scrolled into view, and the find field keeps focus

#### Scenario: OtherMatchesAreMarkedWhileEditing
- **GIVEN** a file open for editing with several matches
- **WHEN** the find bar is open
- **THEN** every match is marked in the editor and the current one is distinguished from the others

#### Scenario: SwitchingViewKeepsTheCurrentMatch
- **GIVEN** the find bar open on a rendered Markdown file, with the third of three matches current
- **WHEN** the user switches to the source view
- **THEN** the third match is still the current one, selected in the source

## REMOVED Requirements

### Requirement: EditModeUsesNativeSelection

**Reason**: The edit buffer is no longer a textarea. The code editor marks every match, in the
source read or edited, so "only the current match, by selection" no longer holds.

**Migration**: `SourceMatchesAreDrawnByTheEditor` replaces it: the current match is still selected,
and the other matches are now marked too.
