## ADDED Requirements

### Requirement: APosterIsRenamed

`update_poster` SHALL accept an optional new title. Given one, the poster SHALL be retitled and its file renamed after it, numbered when another file already has that name, never overwriting one; the poster's id, its revisions and the exports already made SHALL keep theirs.

#### Scenario: ThePosterFileFollowsItsNewTitle
- **GIVEN** a poster in "How many - How much.poster.html"
- **WHEN** the model updates it with the title "Menu du jour"
- **THEN** the folder holds "Menu du jour.poster.html" with the new revision and no longer the old file, and `get_poster` with the same id reads it

#### Scenario: ARenameNeverOverwrites
- **GIVEN** a file "Menu du jour.poster.html" already in the folder
- **WHEN** another poster is retitled "Menu du jour"
- **THEN** its file becomes "Menu du jour (2).poster.html" and the first file is unchanged
