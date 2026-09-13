## MODIFIED Requirements

### Requirement: ATableLeavesAsData

A graph and a sequence leave this application as a figure. A table SHALL leave it as
data: the reader SHALL be able to take the table away as a comma-separated file, as a
spreadsheet workbook, in a form a spreadsheet application opens without repair, and as
Markdown.

An export SHALL carry what the reader is looking at: the declared columns in their
declared order, every row currently shown, and each cell's declared value — a
number as a number, an empty cell where the document declares null. Where rows
declare roles, the export SHALL carry each row's role as a column of its own, since
the colour that states it in the rendering cannot survive the crossing.

In Markdown, a structural heading SHALL become a Markdown heading at its depth, and the
rows beneath it a table of their own, so that a table organised into chapters reads as
chapters. A value containing a character that would break a Markdown table — a pipe, a
backslash, a newline — SHALL be escaped so the value reads as it was declared.

The Markdown export SHALL be available without a browser, to the reference validation
interface and to code in this application, and SHALL produce the same Markdown for the
same rows wherever it runs.

Where a rendering is narrowed, its export SHALL carry only the rows shown, and the
application SHALL say so at the moment of export rather than letting a reader
believe they took the whole table away.

#### Scenario: ATableIsTakenAwayAsCommaSeparatedValues
- **WHEN** a reader exports a table as comma-separated values
- **THEN** the file carries the declared columns and every shown row, with values that contain a separator, a quote or a newline quoted so the file parses back to what was displayed

#### Scenario: ATableIsTakenAwayAsAWorkbook
- **WHEN** a reader exports a table as a spreadsheet workbook
- **THEN** a spreadsheet application opens it without repair, with one sheet whose header row names the declared columns

#### Scenario: ATableIsTakenAwayAsMarkdown
- **WHEN** a reader exports a table with two chapters as Markdown
- **THEN** the file holds each chapter's heading followed by a table of its rows under the declared columns

#### Scenario: MarkdownEscapesWhatWouldBreakTheTable
- **WHEN** a cell's value contains a pipe and a newline
- **THEN** the Markdown table keeps its shape and the value reads as declared

#### Scenario: MarkdownExportRunsWithoutABrowser
- **WHEN** the reference validation interface exports a valid table as Markdown
- **THEN** it writes the same Markdown the reader's export produces for the same rows

#### Scenario: TheExportCarriesTheRolesTheColourCarried
- **WHEN** a table whose rows declare roles is exported in any form
- **THEN** each row's role travels as a value, using the same words the key displays

#### Scenario: ANarrowedTableExportsWhatItShows
- **WHEN** a reader hides a role and then exports the table
- **THEN** the export contains only the rows still shown, and the application states that the export is narrowed

#### Scenario: APlainTableExportsWithoutARoleColumn
- **WHEN** a table that declares no role is exported
- **THEN** the export carries exactly the declared columns, with no column the document did not declare
