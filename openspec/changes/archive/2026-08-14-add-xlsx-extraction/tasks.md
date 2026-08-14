## 1. Configuration

- [x] 1.1 Add `xlsx.maxBytes` to `server/src/config.ts` (optional, default 25 MB, validated as a positive integer), mirroring `pdf.maxBytes` and `docx.maxBytes`, with a test for the default and for a rejected value.

## 2. Workbook structure (`server/src/xlsx.ts`)

- [x] 2.1 `openWorkbook(bytes)`: reuse `zip.ts` and its caps unchanged; detect an OLE container as encrypted, and a package with no `xl/workbook.xml` as not a workbook.
- [x] 2.2 Read `xl/workbook.xml` for sheet names, order, hidden state, and the `date1904` flag (design D7's epoch risk).
- [x] 2.3 Resolve each sheet to its part through `xl/_rels/workbook.xml.rels` — **not** by assuming `sheetN.xml` matches the Nth `<sheet>` (design D1). A reordered or deleted sheet breaks that assumption, and every fixture we write ourselves would hide it.
- [x] 2.4 Read `xl/sharedStrings.xml` into an index, handling `<si>` with several `<r>` runs (formatted text splits one string across runs).

## 3. Cells rendered by format (`server/src/xlsxFormats.ts`)

- [x] 3.1 Read `xl/styles.xml`: `cellXfs` → `numFmtId`, plus the workbook's own `numFmt` entries from id 164 up (design D2).
- [x] 3.2 Built-in format ids: dates (14–17, 22), times, percentages (9, 10), currency (37–44), scientific, fractions. Cover the ones a real workbook uses, not the whole table.
- [x] 3.3 Custom format strings: parse only far enough to decide *kind* (date / time / percent / currency / plain) and *precision*. Recognise and step over conditional sections, colour codes and locale prefixes (`[$-409]`, `[Red]`) — not a format engine.
- [x] 3.4 One documented locale-independent rendering (design D2): `YYYY-MM-DD`, `HH:MM:SS`, `.` decimals, no thousands separator, `%`, currency symbol **only** when the format string states one literally, `TRUE`/`FALSE`, workbook error text verbatim. No dependency on host locale, `Intl`, or `toLocaleString`.
- [x] 3.5 Date serials → dates, honouring both the 1900 system (with Excel's deliberate 1900-02-29) and the 1904 one.
- [x] 3.6 An unresolvable format returns the raw value, appends `*` to the cell, and feeds a per-sheet note counting the marked cells (design D2) — per-cell alone is an unexplained symbol, per-sheet alone does not say which cell.
- [x] 3.7 Tests: a date reads as a date, `0.15` with a percent format reads as `15%`, declared precision is applied, a built-in currency id invents no symbol, a custom format is applied, an unknown one is marked in the cell **and** counted in the note.
- [x] 3.8 A determinism test: extract the same fixture under two different `TZ`/`LANG` settings and assert byte-identical output. This is the one property a locale bug would otherwise hide until a workspace machine differed from CI.

## 4. Sheets to markdown

- [x] 4.1 Walk a sheet with the existing XML scanner; decode `<c r="C7">` references (base-26 columns) and place each cell by position (design D3).
- [x] 4.2 Pad every row to the widest row of the sheet and render through `renderMarkdownTable`, so escaping and column counts are the shared implementation.
- [x] 4.2b Header row = the workbook's column letters; first column = its row numbers (design D3). The sheet's own header row stays in row 1 as data.
- [x] 4.3 Calculated cells: return `<v>`, never `<f>`; a formula with no cached value is marked uncomputed, not empty (design D6).
- [x] 4.4 Skip hidden sheets and hidden columns, count them, name the sheets (design D5). A hidden column is **removed**, not emitted empty — the gap in the header letters is what makes the removal visible.
- [x] 4.5 `extractXlsx(bytes, { sheet, rows, full, maxRows, maxChars, timeoutMs })` — no `mode` (design D4): sheet headings, truncation note naming sheet **and** rows, empty-workbook message naming what is not read.
- [x] 4.6 Tests: empty cells keep their position, every row has the same width, a pipe in a cell cannot break the table, `rows` slices, hidden content is absent and named, a hidden third column makes the header read `A | B | E` with no empty column standing in.
- [x] 4.7 Test the no-sheet coverage explicitly (design D4): with no `sheet`, every visible sheet appears, in workbook order — and under `full`, none of them is truncated.

## 5. Tool and registration

- [x] 5.1 `server/src/xlsxTool.ts` mirroring `docxTool.ts`: `path` named exactly that so `scopeToRoot` confines it, plus `sheet`, `rows`, `full`, `output_path` — the size ceiling checked before opening, and the writable zone threaded to `extractionOutput.ts`.
- [x] 5.2 The tool description leads with the file case, as the other two now do — the lesson from watching an agent take 129 000 characters into context rather than write a file — states that `full`/`output_path` without `sheet` covers every visible sheet, and states the rendering conventions (ISO dates, `.` decimals, `*` = raw) so an agent does not read `1234.50` as a formatting bug.
- [x] 5.3 Register on both toolset paths (`createSandboxedTools` and the non-sandboxed branch in `index.ts`), passing the writable zone.
- [x] 5.4 Extend `server/test/sandbox-tools.test.ts`: present in a read-only sandbox, path-confined (traversal, absolute, symlink, prefix look-alike), destination refused outside the writable zone.
- [x] 5.5 `server/test/xlsxTool.test.ts`: markdown out, sheet and row selection, missing file, not-a-workbook, oversize refused before parsing, `output_path` with no `sheet` writing every visible sheet in workbook order, `output_path` with a `sheet` writing that one only.

## 6. Fixtures

- [x] 6.1 A committed generator (`server/test/fixtures/make-xlsx.mjs`) like the docx one: several sheets, a hidden sheet, a hidden column, sparse rows, a formula with a cached value and one without, a shared-string with runs, cells carrying pipes and backslashes, a custom number format, an unresolvable one, and sheets whose `r:id` order does not match their part names (the D1 trap).
- [x] 6.2 **At least one fixture produced by real software** rather than by our generator — the format cases especially. Hand-written XML proves our reading of the spec, not Excel's writing of it, and that gap is where the Word reader's surprises lived.

## 7. Verification

- [x] 7.1 Full server suite and coverage gate (lines 92 / branches 86 / functions 90).
- [x] 7.2 Full UI suite — untouched by this work, so a failure means something unintended was touched.
- [x] 7.3 `openspec validate add-xlsx-extraction --strict`.
- [x] 7.4 Confirm `npm run build:sea --workspace server` still produces a working blob (needs Node ≥ 26; never runs in PR CI).
- [x] 7.5 Manually verify against a real workbook from the target workspace: dates, percentages and currency read by kind, a wide sheet slices by rows, a hidden sheet is named and not extracted. Compare a screenful against the real application, cell by cell — the check is that no value is in the wrong column and no number lost its meaning, not that the strings match Excel's locale.
- [x] 7.6 Manually verify in the running app with Playwright, per `AGENTS.md`: ask the agent for a figure from a spreadsheet, and check the transcript for which arguments it sent — the tool working is not the same as the agent using it.
