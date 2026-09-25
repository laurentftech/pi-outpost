# Word headings are outline levels

## Why

The Word export maps `#`…`######` onto the Heading 1…6 styles, and the headings look
like headings. They are not chapters: the writer's default heading styles declare a
colour and a size and no outline level, so each heading paragraph sits at body-text
level. Word's navigation pane, its automatic table of contents and chapter numbering all
read the outline level, and pass these headings by.

## What Changes

- The exported document declares outline levels 0–5 on the Heading 1–6 styles, where
  Word keeps them. The styles keep their look.
- No change to which paragraphs are headings, nor to anything else in the export.

## Impact

- `ui/src/export/docxExport.ts` (`buildDocx`).
- Capability `docx-export`: one added requirement.
