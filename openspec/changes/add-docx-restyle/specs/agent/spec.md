## ADDED Requirements

### Requirement: RestyleIsPublishedWithTheWordTools

`docx_restyle` SHALL be published whenever the Word template tools are, and SHALL NOT be registered
where writing is disabled.

#### Scenario: RestyleComesWithTheWordTools
- **WHEN** a prompt names a `.docx` or a `.dotx` file, or the agent reads the `docx-from-template` skill
- **THEN** `docx_restyle` is published with `docx_styles`, `docx_create`, `docx_update` and `docx_render`

#### Scenario: NoRestyleInAReadOnlySandbox
- **GIVEN** a sandbox where writing is disabled
- **WHEN** the tools are registered
- **THEN** `docx_restyle` is absent
