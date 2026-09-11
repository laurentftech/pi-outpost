## ADDED Requirements

### Requirement: Persist collection skill selections

The system SHALL persist, for each repository enrolled as a skill collection, the repository and
the set of its skills that are on, under a key of its own, apart from the configuration file's
skill paths and from the user skill paths. A restart SHALL load the same skills that were on
before it, and no others from that repository. Persisting a selection SHALL NOT rewrite or remove a
skill path declared in the configuration file.

A changed selection SHALL be treated like a changed skill path: it SHALL be persisted and SHALL
replace the agent session, and a persistence failure SHALL keep the live configuration unchanged.
Removing a repository SHALL remove its selection from the persisted settings.

#### Scenario: Restart preserves a collection selection
- **GIVEN** a collection with two skills on
- **WHEN** the server restarts
- **THEN** those two skills are loaded and no other skill from that repository is

#### Scenario: A selection change leaves configuration-file paths intact
- **GIVEN** the configuration file declares a skill path
- **WHEN** the user changes a collection selection and applies it
- **THEN** the persisted configuration still declares that skill path unchanged

#### Scenario: A newly enabled collection skill is visible after apply
- **WHEN** the user turns a collection skill on and the change is applied
- **THEN** the replacement session lists that skill

#### Scenario: A failed write keeps the live selection
- **WHEN** persisting a changed selection fails
- **THEN** the live configuration and the active session keep the previous selection and the client is told the change failed

#### Scenario: Removal clears the persisted selection
- **WHEN** a collection repository is removed
- **THEN** the persisted settings no longer name that repository or any of its skills
