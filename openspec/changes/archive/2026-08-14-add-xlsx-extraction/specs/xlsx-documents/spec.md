# XLSX Documents Specification

## Purpose

Lets the agent read a spreadsheet the workspace already contains — its sheets, its cells, and the
values as the workbook displays them rather than as it stores them.

## ADDED Requirements

### Requirement: ExtractXlsxContentTool

The system SHALL expose a tool that returns the content of a workspace `.xlsx` file as markdown.
The tool SHALL take the file's path, an optional sheet name and an optional row range.

There is no mode. The PDF and Word tools separate text from tables because those documents mix
them; a sheet is a grid and nothing else, so a mode here would name a distinction the format does
not have.

Extraction SHALL read the workbook's own parts. The tool MUST NOT fetch anything over the network,
MUST NOT follow references the workbook makes to external workbooks or data sources, and SHALL be
subject to the same path confinement as the other read tools: a path resolving — symlinks
included — outside the sandbox root SHALL be refused.

Output SHALL name the sheet each block of content came from, and SHALL identify the rows covered, so
a later call can name a sheet and a range and receive exactly it.

#### Scenario: ExtractSheetAsTable
- **WHEN** the tool is called on a workbook
- **THEN** each visible sheet is returned as a markdown table, under a heading naming the sheet

#### Scenario: WithoutASheetEveryVisibleSheetIsReturned
- **WHEN** the tool is called with no sheet named
- **THEN** every visible sheet is returned, in the order the workbook declares them

#### Scenario: RowsAndColumnsAreAddressable
- **WHEN** a sheet is returned
- **THEN** its table's header row carries the workbook's column letters, and its first column carries the workbook's row numbers

#### Scenario: SelectSheetAndRows
- **WHEN** the tool is called with a sheet name and a row range
- **THEN** only those rows of that sheet are returned

#### Scenario: PathOutsideSandbox
- **WHEN** the tool is called with a path that resolves outside the sandbox root
- **THEN** the call is refused with an access-denied error and no file is read

#### Scenario: NotAWorkbook
- **WHEN** the tool is called on a file that is not a readable workbook
- **THEN** it returns an error naming that reason, not an empty result

#### Scenario: EncryptedWorkbook
- **WHEN** the workbook is password-protected
- **THEN** the tool reports that reason rather than returning the encrypted parts

### Requirement: CellsReadAsDisplayed

A spreadsheet does not store what it shows: a cell holds a raw value and a format identifier, and
the same number is a date, a percentage, an amount of money or a plain quantity depending on that
format. The system SHALL resolve each cell's number format — both the built-in identifiers and the
formats the workbook defines itself — and render the value according to what that format means.

Returning the raw value where a format says otherwise SHALL be treated as a defect, not a
simplification: a column of dates rendered as five-digit integers is wrong in a way nothing in the
output would reveal.

**The rendering is deterministic, not a reproduction of Excel's.** Excel's own output depends on the
reader's locale — the same file shows `1/2/2024` or `02/01/2024`, `1,234.5` or `1 234,5`, and the
built-in currency formats carry a symbol that comes from the system, not from the file. Reproducing
that would mean picking a locale the server does not have. So the system SHALL render in one
documented, locale-independent form:

- dates as `YYYY-MM-DD`, times as `HH:MM:SS`, date-times as `YYYY-MM-DD HH:MM:SS`
- numbers with `.` as decimal separator and no thousands separator
- percentages as the displayed number followed by `%`, at the format's precision
- currency as the number, preceded by the currency symbol **only when the format string states one
  literally**; a built-in currency id that names no symbol renders as a plain number
- booleans as `TRUE` / `FALSE`, errors as the workbook's own error text (`#DIV/0!`)

What the system SHALL preserve is the *kind* and the *precision* the format declares; what it SHALL
NOT do is guess a locale.

Where a format cannot be resolved, the system SHALL render the raw value, mark that cell, and carry
a note for the sheet explaining the mark and counting the cells it applies to — a per-cell mark
alone is unexplained, and a sheet note alone does not say which cell.

#### Scenario: DateIsADate
- **GIVEN** a cell holding a date serial number with a date format
- **WHEN** the sheet is extracted
- **THEN** the cell reads as an ISO date, not as the underlying number

#### Scenario: RenderingDoesNotDependOnTheHostLocale
- **GIVEN** the same workbook extracted under different host locale settings
- **WHEN** the sheets are extracted
- **THEN** the output is byte-for-byte identical

#### Scenario: PercentageIsAPercentage
- **GIVEN** a cell holding `0.15` with a percentage format
- **WHEN** the sheet is extracted
- **THEN** the cell reads as `15%`, not as `0.15`

#### Scenario: FormatPrecisionIsKept
- **GIVEN** a cell holding `0.1234` with a format declaring one decimal place
- **WHEN** the sheet is extracted
- **THEN** the cell reads at that precision, not at the stored one

#### Scenario: CurrencyWithoutALiteralSymbol
- **GIVEN** a cell using a built-in currency format that names no symbol in the file
- **WHEN** the sheet is extracted
- **THEN** the number is returned without an invented currency symbol

#### Scenario: CustomFormatIsApplied
- **GIVEN** a cell using a format the workbook defines rather than a built-in one
- **WHEN** the sheet is extracted
- **THEN** that format's kind and precision are applied

#### Scenario: UnresolvableFormat
- **WHEN** a cell's format cannot be resolved
- **THEN** the raw value is returned, that cell is marked, and the sheet carries a note explaining the mark and counting the cells it covers

#### Scenario: TextIsResolvedFromTheSharedTable
- **GIVEN** cells whose text lives in the workbook's shared string table rather than in the sheet
- **WHEN** the sheet is extracted
- **THEN** their text is returned, not the index that points at it

### Requirement: GridPositionsAreRebuilt

A spreadsheet omits empty cells from the file entirely, so a row's cells cannot be read positionally.
The system SHALL place each cell by its own reference, so a value stays in the column it belongs to
and empty cells keep their place.

A row SHALL have the same number of columns as the widest row returned for that sheet, and a cell's
text SHALL NOT be able to alter the structure of the table it lands in.

The grid rebuilt is the grid of the columns actually returned. A hidden column is removed rather
than returned empty (see HiddenContentIsSkippedAndNamed), so positions are contiguous among the
returned columns; the header row's letters are the workbook's own, which is what makes a removal
visible — `A | B | E` says two columns are missing and which.

#### Scenario: EmptyCellsKeepTheirPosition
- **GIVEN** a row whose second and third cells are empty and whose fourth holds a value
- **WHEN** the sheet is extracted
- **THEN** that value appears in the fourth column, with two empty columns before it

#### Scenario: ColumnLettersFollowTheWorkbookNotThePosition
- **GIVEN** a sheet whose third and fourth columns are hidden
- **WHEN** it is extracted
- **THEN** the header row reads `A | B | E`, with no empty columns standing in for the removed ones

#### Scenario: EveryRowHasTheSameWidth
- **WHEN** a sheet is returned
- **THEN** every row of its table declares the same number of columns

#### Scenario: CellCannotBreakTheTable
- **GIVEN** a cell whose text contains a pipe or a backslash
- **WHEN** the sheet is returned
- **THEN** every row still has the same column count

### Requirement: CalculatedCellsReturnTheirValue

A calculated cell SHALL return the last computed result stored in the workbook, rather than the
formula that produces it. The formula text SHALL NOT be returned.

That stored result is not necessarily what a user would see today: a workbook saved with
calculation switched off, or edited by a tool that does not recompute, carries a value that no
longer matches its inputs. The system does not evaluate formulas, so it cannot tell the two apart —
which is why the output describes this as the workbook's stored result and not as the current one.

Where a calculated cell carries no cached value, the system SHALL say so for that cell rather than
returning an empty one, because an empty cell and an uncomputed one mean different things.

#### Scenario: FormulaReturnsItsValue
- **GIVEN** a cell holding `=SUM(B2:B40)` with a cached result
- **WHEN** the sheet is extracted
- **THEN** the result is returned and the formula is not

#### Scenario: FormulaWithoutACachedValue
- **WHEN** a calculated cell has never been computed
- **THEN** the output marks that cell as uncomputed rather than empty

### Requirement: HiddenContentIsSkippedAndNamed

Hidden sheets and hidden columns SHALL NOT be extracted. Their existence SHALL be reported: how many
were skipped and, for sheets, their names.

A hidden column SHALL be removed from the table, not returned as an empty column. An empty column
asserts something false — that the cells there hold nothing — where removal asserts only what is
true. The workbook's column letters in the header row keep the removal visible and keep every
returned column addressable, so nothing about the sheet's real shape is lost by compacting it.

Hidden content usually holds intermediate calculations or data the author deliberately took out of
view. Surfacing it silently would put in front of the agent what someone chose to hide, and omitting
it silently would let a reader believe they had the whole workbook.

#### Scenario: HiddenSheetIsNotExtracted
- **GIVEN** a workbook with a hidden sheet
- **WHEN** it is extracted
- **THEN** that sheet's cells are absent, and the output says it was skipped and names it

#### Scenario: HiddenColumnIsNotExtracted
- **GIVEN** a sheet with a hidden column
- **WHEN** it is extracted
- **THEN** that column's cells are absent, no empty column stands in its place, and the output says a column was skipped

#### Scenario: NothingHiddenSaysNothing
- **WHEN** a workbook hides nothing
- **THEN** the output carries no note about hidden content

### Requirement: BoundedXlsxExtraction

The system SHALL bound what one extraction call returns: a cap on rows read per call and a cap on
the returned markdown. When a cap truncates the result, the output SHALL say so, name the sheet and
rows covered, and state how to request the rest.

Extraction SHALL also be bounded before parsing: a file above the configured size ceiling SHALL be
refused without being opened, and the decompressed size, the entry count and the wall-clock time
SHALL each be capped while reading.

Whole-workbook extraction and extraction to a file SHALL be available on the same terms as for the
other document readers, including the absolute ceiling, the writable-zone rule and the refusal to
overwrite an existing path.

#### Scenario: LargeSheetTruncated
- **GIVEN** a sheet with more rows than the per-call cap
- **WHEN** it is extracted without a range
- **THEN** the covered rows are returned, the result says it was truncated, and it names the remaining range

#### Scenario: WholeWorkbookToFile
- **GIVEN** a destination inside the writable zone
- **WHEN** extraction is requested with it
- **THEN** the whole workbook is written there and the call returns a summary rather than the content

#### Scenario: WholeWorkbookMeansEveryVisibleSheet
- **WHEN** whole-workbook extraction is requested with no sheet named
- **THEN** the result covers every visible sheet, in the order the workbook declares them, each under its own heading
- **AND** no sheet is truncated by the per-call caps, which whole-workbook extraction replaces with the absolute ceiling

#### Scenario: WholeWorkbookWithASheetNamed
- **WHEN** whole-workbook extraction is requested with a sheet named
- **THEN** the result covers that sheet in full and no other

#### Scenario: CompressionBombRefused
- **GIVEN** a workbook whose parts expand far beyond their compressed size
- **WHEN** it is read
- **THEN** extraction stops at the decompression cap and reports that reason

### Requirement: ReportEmptyWorkbook

The system SHALL distinguish a workbook it read successfully but found no cells in from a failure to
read it, and SHALL name what it does not extract — charts, pivot tables, images, comments — so an
empty result is never mistaken for an empty file.

#### Scenario: WorkbookWithNoCells
- **WHEN** a readable workbook yields no cells
- **THEN** the tool says so and names the parts it does not read

#### Scenario: SheetWithOnlyAChart
- **GIVEN** a sheet whose content is a chart rather than cells
- **WHEN** it is extracted
- **THEN** the output says that sheet holds no cell content, naming charts as unread
