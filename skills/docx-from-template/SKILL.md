---
name: docx-from-template
description: Write a Word document (.docx) in a template's house style — or update an existing one section by section, as tracked changes, or bring an old one onto a template (restyle) — with docx_styles, docx_create, docx_update, docx_restyle and docx_render, then check it by rendering it with Word (Windows), LibreOffice or ONLYOFFICE and fixing what the render shows. Use whenever the user asks for a report, memo, specification or letter in their Word template, to turn notes or Markdown into a Word document, or to revise sections of an existing .docx, to fix a document's inconsistent fonts or move it onto a new template — and whenever a .dotx file is involved.
license: MIT
metadata:
  version: "1.0"
---

# Word documents from a template

A Word template carries what "our document" means: heading styles and their numbering, body and
list styles, the cover page, headers and footers, margins, fonts and colours. You write the
content in Markdown; `docx_create` puts it into the template's **styles**, so every heading,
list and table takes the house style without you setting a font. `docx_update` does the same
inside an existing document, and leaves everything you did not touch exactly as it was.

| Task | Tool |
|---|---|
| See what a template offers: styles, numbering, cover page, table of contents | `docx_styles` |
| Read an existing document, and its headings | `docx_extract` |
| Write a new document from Markdown in a template | `docx_create` |
| Change sections of an existing document | `docx_update` |
| Bring an existing document into a template's styles, fixing hand-set fonts | `docx_restyle` |
| See the pages as the reader will, with the chapters and any lost text | `docx_render` |
| Hand over a PDF as well | `docx_render` with `pdf_path` |

## Writing a new document

1. **Read the template.** Call `docx_styles` on it. It says which of its styles your headings,
   paragraphs and lists will wear, whether the template numbers its headings (then do **not**
   type numbers into your headings: "Scope", not "2. Scope"), and whether it has a cover page and
   a table of contents.
2. **Write the content as Markdown.** `#` is a chapter, `##` a section, `###` a subsection — the
   heading levels become the document's outline. Use real lists, tables and `**bold**`; LaTeX
   (`$…$`, `$$…$$`) becomes native Word equations. Reference pictures by workspace path
   (`![Architecture](figures/architecture.svg)`); prefer SVG for diagrams. Mermaid is written as
   code, not drawn: export a diagram to SVG and reference that instead.
3. **Create** with `docx_create`: `template_path`, `output_path` (a `.docx`), and `markdown` (or
   `markdown_path` for a file, whose pictures then resolve against its folder). Pass
   `keep: ["cover", "toc"]` when the template has them and the document should — Word fills the
   table of contents when the file is opened. The template's sample text is never carried over.
4. **Render and look** with `docx_render` — see [Checking the render](#checking-the-render).
5. **Fix and write again** with the same `output_path` and `overwrite: true`.

## Updating an existing document

1. **Read it first** with `docx_extract` to see its headings as they are written. Sections are
   named by heading path: `"Scope"`, or `"Scope > Out of scope"` when a heading name repeats.
2. **Say what changes**, as a list of `edits`:
   - `replace` — new content under an existing heading; the heading stays.
   - `insert_after` — a new section after a whole section (subsections included). Start its
     Markdown with its own heading at the right level (`## New section`).
   - `append` — at the end of the document.
   - `delete` — a section and its subsections.
   All edits apply to the document as it is now; two edits touching the same section are
   refused — combine them into one.
3. **Tracked changes are the default.** The owner of the document reviews and accepts them in
   Word, as they would a colleague's. Only pass `track_changes: false` when the user asks for
   the edits to be written directly. A section holding changes nobody has accepted yet is
   refused: say so, and let the user resolve them in Word first.
4. **Write to a new file** (`output_path`) unless the user asked to change the original — then
   `overwrite: true` without `output_path`.
5. **Render** the result and look at the changed pages: the tracked changes are drawn as markup.

Everything outside the edited sections — other chapters, headers, footers, comments,
pictures — is left byte for byte as it was. The answer says how many content controls, fields
and comment anchors went with a deleted or replaced section: report them to the user.

## Bringing a document into the template

When a document's fonts and sizes are inconsistent, or it has to move onto a new template:

1. Call `docx_restyle` with the document (`path`), the template (`template_path`) and an
   `output_path`. The template's styles, theme and heading numbering replace the document's —
   matched by name, so an English Word's `Heading 1` becomes the template's heading 1 — and fonts,
   sizes and colours set by hand are removed so the text takes its style's. Emphasis, spacing,
   lists, tables and pictures are kept, and the text is checked unchanged before writing.
2. Add `include: ["page"]` for the template's page size and margins, `["headers"]` for its headers
   and footers, only when the user wants them: a document's own title-page footer is often
   deliberate.
3. The removals are tracked formatting changes; the replaced style definitions are not. Tell the
   user so, and that the original file is the way back.
4. Report the styles the answer lists as missing from the template: they were kept as they were,
   and the user decides what they should become.
5. Render the result with `docx_render` and look at it next to the original.

## Checking the render

`docx_render` returns the page count, the chapters as the PDF's bookmarks, a text check, and
pictures of the pages.

- **Chapters**: the bookmarks are your headings as Word sees them. A heading missing from the
  list is a paragraph that only looks like a heading; a wrong level shows as wrong nesting. With
  a template that numbers headings, the numbers are in the bookmarks — check they run 1, 2, 3.
- **Text check**: any paragraph listed is on no page — hidden by a style, lost in a field. Fix it.
- **Look at the pages** for: leftover sample text from the template; tables wider than the page;
  pictures too large or out of place; a heading alone at the bottom of a page; tracked changes
  where you did not expect them.

Word on Windows is the reference rendering. LibreOffice and ONLYOFFICE substitute fonts they do
not have, so line and page breaks can differ; do not chase a page break they show. If no office
application is available, say so: without a render, the document was not checked.

## What it does not do

Footnotes, comments, text boxes and section changes (landscape pages, columns) are not written;
a mermaid diagram is written as its source. Headers, footers and the cover page come from the
template, not from the Markdown. If the user needs one of these, write the rest and say what is
missing rather than faking it.
