# Spec Delta

## Purpose

Lets Open WebUI users persist poster touch-ups as personal revisions that the model can read and continue editing.

## ADDED Requirements

### Requirement: EmbedSavesTouchUpsAsAnOwnerScopedRevision
The embed SHALL save edited poster content as a new revision of that poster for its original owner, using a narrowly scoped capability instead of the tool server bearer secret.

#### Scenario: AUserSavesTouchUps
- **GIVEN** a poster embed opened at revision 2 with edits and a valid save capability
- **WHEN** the user saves the poster
- **THEN** the server stores the edits as revision 3 for that poster's owner and returns revision 3

#### Scenario: AStaleEmbedCannotOverwriteANewerRevision
- **GIVEN** an embed opened at revision 2 and the server has since advanced the poster to revision 3
- **WHEN** the old embed tries to save
- **THEN** the save is refused as a conflict and revision 3 remains unchanged

#### Scenario: TheEmbedDoesNotReceiveTheToolBearerSecret
- **WHEN** the server renders a poster embed
- **THEN** the page contains only a capability limited to saving that poster from its stated revision, and never contains the Open WebUI tool bearer secret

### Requirement: TheModelReadsTheLatestSavedTouchUps
After a successful embed save, the poster's ordinary read and show tools SHALL return the latest saved revision so the model can continue from the user's edits.

#### Scenario: TheModelStartsFromTheSavedTouchUps
- **GIVEN** the user saved a poster embed as revision 3
- **WHEN** the model calls `get_poster` without naming a revision
- **THEN** it receives revision 3 and the user's saved markup and stylesheet

### Requirement: PosterSaveEndpointIsConstrainedToTheConfiguredWebUI
The browser save endpoint SHALL accept writes only from the configured Open WebUI origin and SHALL reject missing or invalid scoped capabilities.

#### Scenario: ADifferentOriginCannotSave
- **GIVEN** the save endpoint is configured for one Open WebUI origin
- **WHEN** a save request comes from another origin
- **THEN** the server refuses it without changing poster data

#### Scenario: AMissingOrInvalidCapabilityCannotSave
- **WHEN** a request has no valid scoped capability
- **THEN** the server refuses it without changing poster data
