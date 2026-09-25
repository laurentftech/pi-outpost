# Tasks

## 1. Establish before writing
- [ ] 1.1 Read real templates part by part (Word-authored, localized French ids, one with numbered headings, one with a cover and a TOC content control).
- [x] 1.2 Confirm the Word object model from Microsoft's VBA reference: `Documents.Open` parameter order, `ExportAsFixedFormat`, `wdExportFormatPDF = 17`, `wdExportCreateHeadingBookmarks = 1`.
- [ ] 1.3 Confirm LibreOffice and ONLYOFFICE convert `.docx` with the existing invocations.

## 2. Shared mapping
- [ ] 2.1 Move `markdownToDocx` and helpers to `shared/`; the browser export unchanged (its suite green, same bytes for the same input).

## 3. Graft
- [ ] 3.1 `docxTemplate.ts`: read styles by name, features, sample body.
- [ ] 3.2 `docxBuild.ts`: body replacement keeping `sectPr`, style-id rewrite, numbering shift, relationship/media re-issue, reachability sweep, `.dotx` re-typing, `keep`, update-fields.

## 3b. Updating
- [ ] 3b.1 `docxUpdate.ts`: resolve heading paths (refuse unknown/ambiguous with the list), section ranges, the four operations, byte-identical copy outside edited ranges, tracked revisions (`w:ins`/`w:del`), refusal on pending revisions in an edited section, report of removed controls/fields/comments.

## 4. Rendering
- [ ] 4.1 Word COM converter; `.docx` through LibreOffice and ONLYOFFICE; page count, bookmarks, text check.

## 5. Tools, skill, settings, publication
- [ ] 5.1 `docx_styles`, `docx_create`, `docx_update`, `docx_render`; registration (no writing tools read-only); publication triggers.
- [ ] 5.2 `office.*` settings; `pptx.*` deprecated (read, warned); `docx.template`; docs updated.
- [ ] 5.3 Skill `docx-from-template`.

## 6. Viewer export
- [ ] 6.1 Template fetch, graft in the browser, "with template"/"plain" choice, failure reporting.

## 7. Proving it
- [ ] 7.1 Unit tests per module; wire test with a scripted model.
- [ ] 7.2 Render through LibreOffice and look; validate packages with an OOXML validator.
- [ ] 7.3 Running app: export with and without template, then the monkey pass.
- [ ] 7.4 Scenario matrix and `npm run check:scenarios`.
- [ ] 7.5 On Windows (project owner): open in Word without repair, render through Word COM.
