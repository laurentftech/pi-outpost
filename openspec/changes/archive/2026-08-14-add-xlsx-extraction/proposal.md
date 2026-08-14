## Why

PDFs and Word documents are readable now; spreadsheets are the third format a workspace is actually
made of, and the one where reading the file wrong is hardest to notice. An `.xlsx` is the same
OOXML package, so the container work is done — `zip.ts`, `xml.ts`, the shared escaper, `full`,
`output_path`, the writable-zone rule, the caps. What is new is what the cells *mean*.

A spreadsheet does not store what it shows. `45292` is a date, `0.15` is a percentage, and which
one a cell is lives in a format identifier pointing into another part of the package. An extractor
that skips that returns numbers that are technically correct and semantically wrong — a column of
dates as five-digit integers — and nothing about the output says so. That is the failure this
change is really about; the parsing is the easy half.

## What Changes

- **An `xlsx_extract` tool**, shaped like the other two: a path, a sheet, a row range, markdown out.
  A read tool, confined the same way, never behind `allowBash`, and with the same `full` /
  `output_path` behaviour those two already have — which without a sheet named means every visible
  sheet, in workbook order. No `mode`: a sheet is a grid, so the text/tables split the other two
  tools offer has nothing to name here.
- **Cells are rendered by what their format means**, in one fixed locale-independent form (ISO
  dates, `.` decimals, `%`, a currency symbol only when the file states one). Number formats are
  resolved — built-in identifiers and the workbook's own — so dates read as dates and percentages as
  percentages. Not a reproduction of Excel's display, which depends on the reader's locale and would
  make the same file extract differently on different machines; what is preserved is the kind and
  the precision. An unresolved format returns the raw value, marked in the cell and explained in a
  note under the sheet.
- **A calculated cell returns the last computed result stored in the workbook** — the value beside
  the formula. Not necessarily what a user sees today: a file saved without recalculation carries a
  stale one, and since we do not evaluate formulas we cannot tell, so the output says "stored"
  rather than "current".
- **Sheets, then rows.** `sheet="Ventes"` and `rows="1-500"`: a workbook is read one sheet at a
  time, and a sheet of 100 000 rows has to be askable in slices.
- **Hidden sheets and columns are not extracted, and their absence is stated** — "2 hidden sheets
  not read". They usually hold intermediate calculations or data the author took out of view, which
  is the same reasoning that keeps tracked deletions out of the Word extraction. A hidden column is
  removed rather than left as an empty one, which would assert that its cells are empty.
- **Empty cells keep their position.** A spreadsheet omits them from the file entirely, so the grid
  is rebuilt from each cell's own reference rather than from the order cells appear in. The table
  carries the workbook's column letters as its header and its row numbers as its first column, so
  every returned cell stays addressable — and a removed hidden column shows as a gap in the letters
  instead of as data sliding left.

Not in this change: charts, pivot tables, images, conditional formatting, cell comments, defined
names, and `.xls` (the pre-2007 binary format). Formula text is not returned either — only the
value it produced.

## Capabilities

### New Capabilities
- `xlsx-documents`: extracting a spreadsheet's sheets, cells and displayed values for the agent —
  including what happens when the workbook is encrypted, when a sheet is hidden, when a cell is
  calculated, and when a value's meaning depends on a format the file stores elsewhere.

### Modified Capabilities
- `file`: `CreateSandboxedTools` — the sandboxed read tools gain spreadsheet extraction beside PDF
  and Word extraction, under the same confinement and the same "never behind `allowBash`" rule.

## Impact

**Server**: a new `server/src/xlsx.ts` (the reader) and `server/src/xlsxTool.ts` (the tool),
mirroring the pairs that exist; `server/src/sandbox.ts` and `server/src/index.ts` gain one
registration each on both toolset paths; `server/src/config.ts` gains the size ceiling.

**Reused unchanged**: `zip.ts`, `xml.ts`, `markdownTable.ts`, `extractionOutput.ts`. No new
dependency — the same constraint that shaped the Word reader, for the same reason: these
deployments are air-gapped, and a package there is something a security team vendors.

**Where this is harder than Word**: the grid is sparse and addressed (`<c r="C7">`), the text lives
in a shared table rather than in the sheet, and a cell's meaning depends on `xl/styles.xml`. Each is
a place where a plausible-looking table can be silently wrong, which is worse than an obvious
failure.
