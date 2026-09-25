## ADDED Requirements

### Requirement: DeckUpdateIsPublishedWithThePresentationTools

`pptx_update` SHALL be published whenever the presentation tools are, and SHALL NOT be registered
where writing is disabled.

#### Scenario: UpdateComesWithTheOtherPresentationTools
- **WHEN** a prompt names a `.pptx` file
- **THEN** `pptx_update` is published with `pptx_layouts`, `pptx_create` and `pptx_render`

#### Scenario: NoDeckUpdateInAReadOnlySandbox
- **GIVEN** a sandbox where writing is disabled
- **WHEN** the tools are registered
- **THEN** `pptx_update` is absent
