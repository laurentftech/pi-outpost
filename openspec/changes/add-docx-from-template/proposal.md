# Word documents from a template

## Why

Documents written here leave as Word files in two ways, and neither can wear the house style:

- the viewer's **Download as a Word document** writes the writer library's own default styles;
- the agent has **no way to write** a `.docx` at all. It can read one (`docx_extract`), and it
  can build a PowerPoint deck from a template (`pptx_create`), but a report, a memo or a
  specification in the organisation's Word template has to be made by hand.

A Word template (`.dotx`, or a `.docx` used as one) carries what "our document" means: heading
styles and their numbering, body and list styles, table style, cover page, headers and footers,
margins, theme fonts and colours. The request is to write into that, and to let the agent check
the result the way it already checks a deck: have an office application draw it and look.

## What Changes

- **`docx_styles`**: reads a template and reports what it offers — the paragraph styles the
  content will map onto (headings 1–6 and whether they are numbered, body, lists, quote, code,
  caption), table styles, whether it has a cover page, headers/footers, and a table of contents,
  and its sample content.
- **`docx_create`**: writes a new `.docx` from a template and Markdown. The Markdown is mapped
  with the viewer export's own mapping (headings, lists, tables, emphasis, links, code, block
  quotes, equations, images), and the result is grafted into the template's package so that its
  styles, numbering, section settings, headers, footers and theme apply. The template's sample
  body is dropped, except a cover page and a table of contents when asked to keep them.
- **`docx_render`**: draws the document with Word (COM, on Windows), LibreOffice or ONLYOFFICE,
  returns pictures of its pages and a check that every paragraph reached the PDF, and can save
  the PDF — `pptx_render`'s pipeline, for Word.
- **Skill `docx-from-template`**: the choose-styles → write → render → fix loop.
- **Viewer export with a template**: the download can use a template; a default template is
  configurable, and the export without one stays exactly as today.
- Settings: `docx.template` (the default export template) and the Word renderer choice.

## Impact

- New capability `docx-templates`; `docx-export`, `config` and `agent` gain requirements.
- The Markdown→Word mapping moves from `ui/src/export` to `shared/` so the browser export and the
  server tool write the same structure from the same code.
- Server: new modules beside `pptxBuild.ts` / `presentationRender.ts`; the renderers gain a Word
  path (COM `Documents.Open` / `SaveAs2 … wdFormatPDF`).
- No new dependency beyond `docx`, already used by the export.
