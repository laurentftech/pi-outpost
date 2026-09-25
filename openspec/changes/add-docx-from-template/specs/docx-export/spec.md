## ADDED Requirements

### Requirement: ExportWithATemplate

When a default Word template is configured, the viewer's Word export SHALL offer to write the
document into it, with the same result as `docx_create` for the same Markdown and template, apart
from diagrams, which the browser draws. The export without a template SHALL remain available and
unchanged. A template that cannot be loaded SHALL be reported with its reason and SHALL NOT prevent
the export without it.

#### Scenario: ExportUsesTheConfiguredTemplate
- **GIVEN** `docx.template` names a template
- **WHEN** a Markdown file is exported with the template
- **THEN** the downloaded document carries the template's styles, header and footer

#### Scenario: WithoutATemplateTheExportIsUnchanged
- **GIVEN** no `docx.template`
- **WHEN** a Markdown file is exported
- **THEN** the export offers no template and produces the same document as before this change

#### Scenario: ABrokenTemplateDoesNotBlockThePlainExport
- **GIVEN** `docx.template` names a file that is missing or unusable
- **WHEN** the user exports
- **THEN** the template export reports why, and the plain export still works
