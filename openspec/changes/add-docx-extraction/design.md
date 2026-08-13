## Context

See `proposal.md` — Why. What shapes the approach:

- **`pdf_extract` is the template, and it is one release old.** `server/src/pdf.ts` (the reader) and
  `server/src/pdfTool.ts` (the `ToolDefinition`) are a pair worth mirroring: a `path` parameter
  named exactly that so `scopeToRoot` confines it with no new security code, caps before parsing,
  and failure reasons the model can act on rather than retry blindly.
- **A `.docx` is a zip of XML parts.** `word/document.xml` holds the body; the parts this change
  does not read (`numbering.xml`, `footnotes.xml`, headers, comments) are separate entries.
- **Structure is declared, not inferred.** `<w:tbl>` / `<w:tr>` / `<w:tc>` say what a table is, and
  a paragraph's style says it is a heading. The three-pass geometry in `pdf.ts` has no counterpart
  here, and pretending otherwise would be the wrong lesson to carry over.
- **The single-file build takes no data files.** pdf.js's fonts and cMaps could not be bundled and
  are resolved from disk when present (design D7 of the PDF change). A dependency that is pure
  JavaScript avoids repeating that.
- **Server tests are `node --test` with coverage gates** (lines 92 / branches 86 / functions 90).

## Goals / Non-Goals

**Goals:**
- One reader with one entry point, `extractDocx`, testable without a tool or a server.
- Caps that hold on hostile input, applied before the expensive work rather than after.
- Failure messages that name a reason: not a docx, encrypted, too large, budget exceeded.

**Non-Goals:**
- A viewer. A `.docx` selected in the tree keeps its current refusal.
- Lists, footnotes, headers, footers, comments, images. Each lives in another part of the package
  and would widen both the parser and what reaches the agent's context.
- Fidelity to Word's *rendering*: no page numbers, no column widths, no fonts.
- `.odt`, `.doc`, `.rtf`.

## Decisions

### D1 — Two dependencies, both pure JavaScript

`fflate` (~800 KB unpacked, no dependencies) to read the zip, `fast-xml-parser` (~1.3 MB unpacked,
no dependencies) to read the XML.

*Alternative — hand-rolled.* A zip central-directory reader is a hundred lines and `inflateRaw` is
in `node:zlib`; an XML scanner is not. OOXML uses namespaces, entities, and attribute forms that a
regex reader gets wrong quietly — on attacker-controlled input, quietly wrong is the worst outcome.

*Alternative — `mammoth`.* Purpose-built for docx and would do most of this, but it targets HTML,
carries its own dependency tree, and its style mapping is a second configuration surface. We need
markdown and control over what is *not* extracted.

Both bundle as code, so unlike pdf.js there is nothing to resolve from disk at runtime and nothing
that goes missing in the SEA build.

### D2 — Blocks, not pages

A `.docx` has no pages; pagination belongs to whoever renders it. The unit of continuation is the
**block** — one paragraph or one table, numbered in document order from 1.

`docx_extract(path, blocks?, mode?)` where `blocks` reads `"12"`, `"5-40"`, `"5-40,80"`, exactly as
`pages` does for PDFs. A truncated result ends with the range to request next.

*Alternative — character offsets.* Precise and useless to a reader: nobody asks for "characters
4000 to 8000 of the spec".

### D3 — Caps come before the parse, and inside it

Four bounds, in the order they can bite:

1. **File size**, from config (`docx.maxBytes`, default 25 MB as for PDFs): a `stat` before the file
   is opened.
2. **Decompressed total**: reading stops once the parts read exceed a multiple of the file's own
   size (bomb guard), reported as such.
3. **Entry count**: a package with an absurd number of entries is refused before any inflation.
4. **Deadline**: wall-clock, checked between parts and between blocks.

Then the same output caps as the PDF path: a block cap and a character cap, whichever binds first.

The PDF reader could rely on pdf.js to be defensive about its own input. Here the compressed
container is ours to police, which is the one place this change is *more* exposed than its model.

### D4 — Only `word/document.xml`, by name

Entries are read by exact name, never by walking the archive. A zip can carry entries named
`../../etc/passwd`; nothing here ever turns an entry name into a filesystem path, so the classic
zip-slip has no reachable sink — and reading by name keeps it that way by construction rather than
by a check that could be dropped later.

XML entity expansion is disabled: `fast-xml-parser` does not resolve external entities, and internal
entity processing stays off.

### D5 — Accepted text only, at the run level

Word marks revisions inside a paragraph: `<w:ins>` wraps inserted runs, `<w:del>` wraps deleted ones
(whose text sits in `<w:delText>`). The walker keeps the first and skips the second, so deletion is
a property of the traversal rather than a post-filter — there is no mode, flag or code path by which
deleted text can reach the output.

### D6 — Escaping is shared with the PDF path

`escapeCell` in `pdf.ts` escapes backslashes then pipes, which is exactly what a docx cell needs.
It moves to a small shared module rather than being copied — the CodeQL finding that produced it
(`js/incomplete-sanitization`, alert #10) is precisely the kind that returns when an escaper is
duplicated and only one copy is fixed.

### D7 — Registration mirrors `pdf_extract`, on both toolset paths

Appended to the read tools in `createSandboxedTools`, and passed as a custom tool when no sandbox
is configured. The parameter is named `path` so `scopeToRoot` confines it with no new security code.

## Risks / Trade-offs

- **Two new dependencies on untrusted input** → both are widely used and dependency-free; the caps
  in D3 sit above them, so a bug in either is bounded by our budget rather than by its own.
- **A docx with content only outside the body** (headers, footnotes, text boxes) reads as empty →
  the spec requires saying which parts are not read, so the answer is "not extracted here", never
  "the document is blank".
- **Block numbering shifts if the document changes** between two calls → same property as PDF page
  ranges; the tool reports the total so a caller can notice.
- **Text boxes and content controls** hold text inside the body part but outside the paragraph flow.
  They are not read in this change; the empty-document message is what keeps that visible.
- **Coverage gates** are near their floor on the server workspace; a new module needs its own tests
  to avoid dragging the whole suite under.

## Migration Plan

Additive: one tool, one config key with a default, no protocol change. Rolling back is removing the
two modules and their registrations.
