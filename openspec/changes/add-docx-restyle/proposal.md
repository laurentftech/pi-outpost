# Bring a Word document into a template's house style

## Why

Documents that have lived a while drift from the house style. Someone pasted a paragraph from an
e-mail in Calibri 11, someone else made a heading by typing it in bold 14 pt, a third person set
Arial on a whole section by hand. Each looked right when it was done; together they make a report
whose fonts, sizes and spacing change from page to page. And when the organisation moves to a new
template — new fonts, new heading colours, new numbering — every existing document has to be
brought across.

Word can attach a new template and update the document's styles, but that changes only the style
definitions: every piece of formatting set by hand still wins over them, so the document looks
the same afterwards. Removing that hand formatting is done paragraph by paragraph (Ctrl+Space,
Ctrl+Q), with no record of what was changed.

The tools added for templates (`docx_styles`, `docx_create`, `docx_update`, `docx_render`) write
new content in the house style, but none of them touches the formatting of what is already
written. The request, from a colleague of the project owner, is to use the tool "to correct
style inconsistencies and bring documents onto the new template (font, size)".

## What Changes

- **`docx_restyle`**: takes an existing `.docx` and a template, and writes a copy of the document
  in which:
  - the template's style definitions, theme (fonts and colours) and heading numbering replace the
    document's, styles matched by name as `docx_create` matches them;
  - formatting set by hand that overrides those styles — fonts, sizes, colours by default — is
    removed, so the text takes the style it is in;
  - formatting that carries meaning — bold, italic, underline, strike-through, superscript and
    subscript, highlight — is kept;
  - the text, the tables, the pictures, the fields, the comments and the document's own lists are
    left as they are; the tool checks that the text of every paragraph is unchanged before it
    writes, and refuses to write otherwise;
  - on request, the template's page setup and its headers and footers replace the document's.
- **Tracked by default.** The formatting removed from paragraphs and runs is written as tracked
  formatting changes (`w:rPrChange`, `w:pPrChange`, `w:sectPrChange`) attributed to pi-outpost,
  so the document's owner sees each one in Word and accepts or rejects it. The replacement of the
  style definitions, theme and numbering cannot be a revision; the answer says so, and the
  original file is kept unless the call asks to overwrite it.
- **What it cannot decide is reported, not guessed**: styles the template does not have (listed,
  and mappable with `style_map`), and paragraphs that look like headings without being headings
  (bold, larger, short, in a body style), listed with where they are.
- **`dry_run`**: the same report without writing, so the user sees what would change first.
- **Skill `docx-from-template`** gains the loop: read the template → dry run → restyle → render
  and compare → report what was left for a person to decide.

## Impact

- `docx-templates` gains one requirement; `agent` gains the tool's publication rule.
- Server: a new module beside `docxUpdate.ts`, reusing the package reading
  (`readWordPackage`), the style correspondence by name and numbering shift of the graft
  (`WordComposer`), and the revision writing of `docx_update`.
- No new dependency. No change to the viewer.
