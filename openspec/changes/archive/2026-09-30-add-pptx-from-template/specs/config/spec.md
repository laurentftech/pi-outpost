## ADDED Requirements

### Requirement: PresentationRendererSettings

The configuration SHALL support choosing the office application `pptx_render` draws decks with —
`pptx.renderer`: `auto` (the default), `powerpoint`, `libreoffice` or `onlyoffice` — naming the
LibreOffice and ONLYOFFICE Document Builder executables (`pptx.libreofficePath`,
`pptx.onlyofficePath`, resolved relative to the configuration file), and bounding how long one
rendering may take (`pptx.renderTimeoutMs`, default 120 000).

A configured executable SHALL be the one used: when it does not exist, that converter SHALL be
reported unavailable rather than replaced by one found elsewhere. Unlike the git executable, a
missing converter SHALL NOT stop the server from starting — rendering is one tool's concern, and
the rest of the product works without it.

An unknown renderer, an empty executable path, or a timeout that is not a positive integer SHALL
make loading the configuration fail with an error naming the setting.

The same settings SHALL reach the RPC child with the rest of its tool settings.

#### Scenario: RendererDefaultsToAuto
- **GIVEN** a configuration with no `pptx` rendering settings
- **WHEN** it is loaded
- **THEN** the renderer is `auto`, no executable is named, and the timeout is 120 000 ms

#### Scenario: ConfiguredExecutableIsUsedAndNotReplaced
- **GIVEN** a configuration naming a LibreOffice executable
- **WHEN** a deck is rendered
- **THEN** that executable is the one found, and if it is missing no other LibreOffice is used in its place

#### Scenario: InvalidRendererSettingIsRefused
- **WHEN** the configuration names an unknown renderer, an empty executable path or a non-positive timeout
- **THEN** loading fails with an error naming the setting
