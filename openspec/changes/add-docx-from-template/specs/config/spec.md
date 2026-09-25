## ADDED Requirements

### Requirement: WordTemplateAndOfficeRendererSettings

The configuration SHALL accept `docx.template`, the default Word template for the viewer export,
resolved relative to the configuration file; a named file that does not exist SHALL be reported
when used, not at startup.

The office renderer settings SHALL be `office.renderer` (`auto`, `word`, `powerpoint`,
`libreoffice`, `onlyoffice`; `word` and `powerpoint` each apply to their own kind of document and
fall back as `auto` does for the other), `office.libreofficePath`, `office.onlyofficePath` and
`office.renderTimeoutMs`. The `pptx.renderer`, `pptx.libreofficePath`, `pptx.onlyofficePath` and
`pptx.renderTimeoutMs` keys SHALL keep working as aliases; when both are given, the `office` key
SHALL win and the conflict SHALL be logged.

#### Scenario: PptxRendererKeysStillWork
- **GIVEN** a configuration written for 0.29 with `pptx.renderer: "libreoffice"`
- **WHEN** it is loaded
- **THEN** documents and decks render with LibreOffice

#### Scenario: OfficeKeysWinOverTheirAliases
- **GIVEN** `office.renderer: "onlyoffice"` and `pptx.renderer: "libreoffice"`
- **WHEN** the configuration is loaded
- **THEN** the renderer is ONLYOFFICE and the conflict is logged
