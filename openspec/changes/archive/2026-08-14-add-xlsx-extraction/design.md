## Context

See `proposal.md` — Why. What shapes the approach:

- **The container work is done.** `server/src/zip.ts` reads one entry by name with a byte budget;
  `server/src/xml.ts` scans WordprocessingML-shaped XML and refuses a DOCTYPE. An `.xlsx` is the
  same OOXML package, so neither needs changing — the XML scanner is not Word-specific, it is
  element-name agnostic.
- **The tool layer is done too.** `extractionOutput.ts` owns the destination, the writable zone and
  the refusal to overwrite; `markdownTable.ts` owns escaping. `full` and `output_path` live in the
  tool, not the reader.
- **A spreadsheet's content model is genuinely different.** Text lives in `xl/sharedStrings.xml`,
  not in the sheet. Cells are addressed (`<c r="C7">`) and empty ones are simply absent. A cell's
  displayed value depends on `xl/styles.xml`. None of this has an equivalent in the Word reader.
- **The Word reader found its bugs on real documents**, not on fixtures: a 1×1 layout table and a
  file with no heading styles. The equivalent here is a workbook produced by something other than
  Excel — Google Sheets, LibreOffice, an export from a BI tool.

## Goals / Non-Goals

**Goals:**
- Cells that read as the workbook displays them, because that is what a question about a
  spreadsheet is about.
- A grid rebuilt from cell references, so a value is never one column off.
- Hidden content skipped and *named*, so neither the reader nor the agent is misled.

**Non-Goals:**
- Charts, pivot tables, images, conditional formatting, comments, defined names.
- Formula text, or evaluating formulas ourselves.
- `.xls` (the pre-2007 binary compound file) and `.csv` (already plain text; `read` handles it).
- A viewer. A spreadsheet selected in the tree keeps its current refusal.

## Decisions

### D1 — Three parts, read by name

`xl/workbook.xml` (sheet names, order, and which are hidden), `xl/sharedStrings.xml` (the text), and
each `xl/worksheets/sheetN.xml`. `xl/styles.xml` joins them for D2. Entries are read by exact name
through the existing zip reader, never by walking the archive — the same property that keeps zip-slip
unreachable in the Word path.

The sheet-name-to-part mapping goes through `xl/_rels/workbook.xml.rels`: `<sheet r:id="rId3">` is an
indirection, and assuming `sheetN.xml` matches the Nth `<sheet>` element is wrong on workbooks whose
sheets have been reordered or deleted. That assumption is the kind that holds on every fixture we
would write ourselves and fails on a real file.

### D2 — Number formats, and why this is the change

A cell is `<c r="B2" s="3"><v>45292</v></c>`. `s="3"` indexes `cellXfs` in `xl/styles.xml`, whose
entry carries a `numFmtId`. Ids below 164 are built in (14 is a date, 9 and 10 are percentages, 44
is currency…); ids from 164 up are defined in the same file as format strings.

The reader resolves that chain and renders accordingly: date serials become dates (the 1900 epoch,
with Excel's deliberate 1900-02-29 leap-year bug, which is part of the format, not a mistake to
correct), percentages get their sign, currency keeps a symbol the file actually states.

**Deterministic, not Excel-identical.** "As Excel displays it" is not a specification: Excel's
display depends on the reader's locale. Built-in id 14 is documented as `mm-dd-yy` but renders as
the *system* short date; the built-in currency ids (37–44) take their symbol and separators from the
system too. Two people open the same file and see different strings. A server has no such locale,
and inventing one would make the output depend on where it runs.

So the reader renders in a fixed form and says so: ISO dates and times, `.` as decimal separator, no
thousands separator, `%` for percentages, a currency symbol only when the format string contains one
literally. What is preserved is the format's **kind** (date / time / percent / currency / plain) and
its **declared precision** — the two things that carry meaning. What is dropped is presentation that
only ever existed at display time anyway.

*What this costs:* a cell shown as `1 234,50 €` comes back as `1234.50`, or `€1234.50` if the
workbook's own format string carries the `€`. The number and its precision are right; the styling is
not reproduced. That is the correct trade for a machine reader — and reversing it would make
extraction non-reproducible across hosts, which is worse than plain.

*Custom format strings* are parsed only far enough to decide kind and precision, not into a format
engine. Conditional sections, colour codes and locale prefixes (`[$-409]`, `[Red]`) are recognised
and stepped over rather than implemented.

*Why this is not optional:* a column of dates returned as `45292, 45293, 45294` is wrong in a way
the output does not reveal. Every other failure in this reader announces itself; this one produces a
plausible table.

**When the chain breaks**, the value is returned raw and marked at both scales: a `*` appended to
the cell, and one note under the sheet — `* 3 cells: number format could not be resolved, raw value
shown`. Per-cell alone is an unexplained symbol; per-sheet alone does not say *which* number is not
to be trusted. Both together are the smallest thing that answers "is this figure displayed or raw?"
for a specific figure. `*` is a character `renderMarkdownTable` does not escape and a reader will
not mistake for data.

### D3 — The grid is rebuilt from references

`<c r="C7">` gives the column letters and the row number. Empty cells and empty rows are absent from
the file, so a row's cells cannot be read positionally: `A1`, `D1` is a row of four columns, not two.

Column letters are decoded base-26 (`A`=1, `Z`=26, `AA`=27), each row is filled to the widest row of
its sheet, and the result goes through `renderMarkdownTable`, which already pads and escapes.

**The table stays addressable**: the header row carries the workbook's column letters, and the first
column carries its row numbers. Three things fall out of that. A follow-up question ("what is in
D12?") maps onto the output. A truncation note naming `rows 501-12400` can be checked against the
rows returned. And a removed hidden column is visible as a gap in the letters rather than as
silently shifted data. The sheet's own header row, if it has one, stays where it is — as data in
row 1, which is what it is.

This is exactly the property `tableau.docx` demonstrated for Word — a value staying under its own
column — except that Word *declares* the grid and a spreadsheet does not.

### D4 — Sheets, then rows

`xlsx_extract(path, sheet?, rows?, full?, output_path?)`. Without `sheet`, every visible sheet is
returned in workbook order, each under a `## <name>` heading. `rows="1-500"` slices one sheet.

**No `mode`.** The PDF and Word tools take one because those documents mix prose and tables and a
caller may want only one of them. A sheet is a grid; "text mode" would name a distinction the format
does not have. Carrying the parameter for symmetry would mean documenting a value that changes
nothing.

`full` and `output_path` inherit the same default: **every visible sheet, in workbook order**,
concatenated under its headings, with the per-call caps replaced by the absolute ceiling. With
`sheet` named, they cover that sheet in full and no other. This is implied by the parameter being
optional, but it is the whole point of the feature — the agent that stopped halfway through a
document is the reason this exists — so it is a scenario rather than an inference.

The truncation note names both: `Truncated: rows 1-500 of 12 400 in "Ventes". Call again with
sheet="Ventes" rows="501-12400"`.

*Alternative — A1 ranges (`Ventes!A1:D200`).* Familiar, but it needs a reference parser and makes the
agent guess column bounds it cannot see. Rows are the axis that actually grows.

### D5 — Hidden sheets and columns are skipped, and said

`<sheet state="hidden">` and `<col hidden="1">`. Neither is extracted; both are counted, and hidden
sheets are named.

The reasoning is the one behind `AcceptedTextOnly` in the Word reader: what someone took out of view
should not arrive in the agent's context by a side door. Skipping *silently* would be the opposite
error — a reader believing they have the whole workbook. So: skipped, and named.

**A hidden column is removed, not blanked.** The alternative — keeping the position and emitting an
empty cell — reads as "this column is empty", which is a false statement about the file, and it is
indistinguishable from a genuinely empty column. Removal states less and states it truly. This does
not contradict D3: the grid is rebuilt over the columns actually returned, and because the header
carries the workbook's letters, the removal shows up as `A | B | E`. Compaction without those
letters would be the bad version of this — data silently sliding left.

### D6 — Calculated cells return their cached value

`<c><f>SUM(B2:B40)</f><v>1240</v></c>` — the `<v>` is the **last computed result stored in the
workbook**. It is returned; the formula is not.

Not "what the user sees": a workbook saved with automatic calculation off, or written by a tool that
does not recompute, stores a value that no longer follows from its inputs. We do not evaluate
formulas, so we cannot detect that — and a reader who believes the number is live would be misled by
us. Hence the wording in the spec and in the tool's own output: the workbook's stored result.

A cell with `<f>` and no `<v>` has never been computed: marked as such, because an empty cell and an
uncomputed one are different facts.

### D7 — Bounds, inherited and extended

The zip caps (entry count, decompressed bytes) and the deadline come from the existing reader.
New: a per-call row cap, because a sheet can hold a million rows where a Word document holds
thousands of blocks. `full` and `output_path` behave exactly as they do for PDF and Word — the tool
layer is shared, so this is wiring rather than design.

## Risks / Trade-offs

- **A plausible-but-wrong table** is this reader's characteristic failure: a misresolved format or a
  misplaced cell looks like data. Mitigations: formats resolved through the real chain (D2),
  positions rebuilt from references (D3), fixtures built from *actual* Excel output rather than
  hand-written XML for at least the format cases, and a real workbook from the target workspace
  before this is called done.
- **Date epochs**: workbooks can use the 1904 system (`<workbookPr date1904="1"/>`). Rare, and wrong
  by four years when missed — so it is read rather than assumed.
- **A sheet of 500 000 rows** would blow the output cap long before the row cap; the truncation note
  is what keeps that usable, and the file destination is the answer for "give me all of it".
- **Streaming**: the sheet XML is parsed with the same event scanner as Word, so a huge sheet does
  not become a huge tree. The row cap stops the walk rather than filtering afterwards.
- **Rendering that is right but unfamiliar**: someone comparing our output to their screen will see
  `1234.50` where Excel showed `1 234,50 €`. Accepted deliberately (D2) — reproducibility across
  hosts beats matching one host's locale — and stated in the tool's description so it is not
  discovered as a surprise.
- **Coverage gates** on the server workspace are near their floor; a new module needs its own tests.

## Migration Plan

Additive: one tool, one config key with a default, no protocol change, no dependency. Rolling back
is removing the two modules and their registrations.
