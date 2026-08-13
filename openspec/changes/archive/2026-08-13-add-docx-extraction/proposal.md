## Why

`pdf_extract` (0.7.0) closed one half of the "documents the workspace is made of" gap. The other
half is Word: a `.docx` is a NUL-bearing zip, so the file browser refuses it as binary and the
agent's read tools return compressed rubbish. Asking what a specification document says still means
a shell, an external converter, and `sandbox.allowBash`.

There is a difference worth stating up front, and it makes this the *easier* half: a `.docx` states
its own structure. Headings are headings, tables are `<w:tbl>` with rows and cells. Nothing has to
be inferred from where the ink landed — the reconstruction guesswork that `pdf_extract` is honest
about having does not exist here.

## What Changes

- **A `docx_extract` tool**, shaped like `pdf_extract`: a path, a range, a mode, and markdown out.
  It is a read tool — available wherever `read` is, confined the same way, never behind
  `allowBash`.
- **Body text, headings and tables**, from the document's own markup: paragraph styles become `#`
  levels, `<w:tbl>` becomes a GFM table with its real rows and cells.
- **Accepted text only.** Tracked insertions are kept and tracked deletions dropped — what Word
  shows as "Final". Text the author deleted never reaches the agent.
- **A block range instead of a page range.** A `.docx` has no pages: pagination is invented by the
  renderer, not stored in the file. The unit of continuation is the block (a paragraph or a table),
  and a truncated result names the range to ask for next, as the PDF one does.
- **Bounded like the PDF path**: an output cap, a block cap, a parse deadline, and a refusal for a
  file above the configured ceiling.

Not in this change: a viewer (a `.docx` selected in the tree keeps its current refusal), lists,
footnotes, headers, footers, comments, images, `.odt`, and the legacy binary `.doc`. Lists are the
first thing worth adding next — Word keeps their numbering in a separate part, which is why they
are not free.

## Capabilities

### New Capabilities
- `docx-documents`: extracting a Word document's text, headings and tables for the agent —
  including what happens when the file is not a `.docx`, is password-protected, carries tracked
  changes, or has no readable body at all.

### Modified Capabilities
- `file`: `CreateSandboxedTools` — the sandboxed read tools gain Word extraction beside PDF
  extraction, under the same confinement and the same "never behind `allowBash`" rule.

## Impact

**New dependencies**: an unzip and an XML reader in `server`. A `.docx` is a zip of XML parts, and
neither is worth hand-rolling against untrusted input. Both must be pure JavaScript so the
single-file build keeps working — the lesson from pdf.js, whose font and cMap *data files* could
not be bundled.

**Server**: a new `server/src/docx.ts` (the reader) and `server/src/docxTool.ts` (the tool),
mirroring the PDF pair; `server/src/sandbox.ts` and `server/src/index.ts` gain one registration
each on both toolset paths; `server/src/config.ts` gains the size ceiling.

**Untrusted input**: a `.docx` is attacker-controlled *compressed* data, which the PDF path never
was. A zip bomb, a part that expands to gigabytes, an entry count in the millions, and XML entity
expansion are all reachable from a file someone dropped in the workspace. Caps come before parsing,
not after.
