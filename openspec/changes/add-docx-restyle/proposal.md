# Bring a Word document into a template's house style

## Why

Documents that have lived a while drift from the house style: a paragraph pasted from an e-mail
in Calibri 11, a section set to Arial by hand, a colour picked from the toolbar. And when the
organisation moves to a new template, every existing document has to be brought across.

Word can attach a new template and update the document's styles, but formatting set by hand
still wins over them, so the document looks the same afterwards. The Word tools write new content
in the house style; none of them touches what is already written. A colleague of the project
owner asked to use the tool "to correct style inconsistencies and bring documents onto the new
template (font, size)".

## What Changes

- **`docx_restyle`**: takes an existing `.docx` and a template and writes a copy in which the
  template's styles, theme and heading numbering replace the document's (styles matched by name,
  as `docx_create` does), and fonts, sizes and colours set by hand are removed so the text takes
  its style's. Everything else — emphasis, spacing, lists, text, tables, pictures — is kept.
- The text of every paragraph is checked unchanged before writing.
- Tracked by default, like `docx_update`: the owner sees each removal in Word and accepts or
  rejects it.
- The `docx-from-template` skill gains the loop: restyle, render, report.

## Impact

- `docx-templates` gains one requirement; `agent` gains the tool's publication rule.
- Server: one new module reusing `readWordPackage`, the graft's style correspondence and
  numbering shift (`WordComposer`), and `docx_update`'s revision writing.
- No new dependency. No change to the viewer.
