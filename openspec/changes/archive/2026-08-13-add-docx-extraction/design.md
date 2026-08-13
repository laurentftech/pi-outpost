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

### D1 — No new dependency at all

**Revised twice at implementation time, and the second revision is the one that matters.**

The first version named `fflate` and `fast-xml-parser`, calling both dependency-free. The check
task 1.1 demanded showed `fast-xml-parser@5` pulls six transitive packages, so the second version
dropped it for `sax` (zero dependencies, 85 M downloads a week). That was still the wrong frame:
**the deployments this serves are air-gapped.** There, a dependency is not a download — it is a
package someone's security team has to vendor, review and re-review, for a target that cannot fetch
anything at runtime. "Popular and dependency-free" does not shrink that work; only *absent* does.

So both halves are written here, against the standard library:

- **Zip**: `node:zlib`. A zip's end-of-central-directory record and its local file headers are fixed
  binary structures, and this reader performs exactly one operation — find an entry by exact name
  and inflate it. `createInflateRaw()` is a stream, so the decompression cap (D3) applies *while*
  the data expands instead of being measured after the fact.
- **XML**: a scanner scoped to WordprocessingML, not a general parser. It handles what
  `word/document.xml` actually contains — start, end and self-closing tags with quoted attributes,
  text, CDATA, comments, processing instructions — and **refuses a DOCTYPE outright**.

That refusal is the point worth keeping: with no internal subset accepted, entity expansion is not
mitigated, it is unreachable. A library would have given us a *default* we then had to verify;
rejecting the construct is a property we can state.

The honest cost: a hand-rolled scanner can be quietly wrong where a mature library would not, and
quiet wrongness on attacker-controlled input is the failure mode this whole change is built to
avoid. Three things hold it down — the scanner only treats what it understands as structure and
everything else as text, the fixtures include real exports from both Word and Google Docs (whose
markup differs), and no output is trusted downstream: cells go through the shared escaper (D6).

*Rejected:* `fast-xml-parser@5` (six transitive packages), `fast-xml-parser@4.5.3` (a major version
behind), `sax` (still a package to vendor), `fflate` (a dependency to do less than `node:zlib`),
`mammoth` (targets HTML, own tree, style mapping as a second configuration surface).

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
2. **Decompressed total**: inflation runs as a stream with a byte budget, so a bomb is stopped
   *while* it expands rather than measured afterwards (D1). Reported as its own reason.
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

Entity expansion is unreachable rather than disabled: the scanner refuses a DOCTYPE, so there is no
internal subset in which entities could be declared (D1).

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

### D8 — What a real document taught us

Added after running the reader against a real Word file (a 107-block edition of Descartes'
*Discours de la méthode*, produced by a conversion tool rather than by Word):

- **Its cover page is a 1×1 table.** Layout, not data. A single-cell table is now returned as text:
  handing the model an empty header row and a separator around one paragraph of prose is noise it
  has to parse past.
- **It declares no heading styles at all** — `BodyText`, `Normal`, `UserStyle_13`, and titles set by
  direct formatting. So the heading feature contributes nothing on this document, and the extractor
  is right not to invent levels from font size. Documents written in Word do carry `Heading1`; ones
  converted from other tools often do not.

  The reachable improvement, deliberately not in this change: `word/styles.xml` maps a custom style
  to an outline level, so `UserStyle_13` may well *be* a heading two indirections away. Reading that
  part would find them, at the cost of a second part to parse and a style table to resolve.

## Risks / Trade-offs

- **Hand-rolled parsing of attacker-controlled input** → the caps in D3 bound every loop, the
  scanner refuses what it does not understand as structure, and the fixtures cover both Word and
  Google Docs output. This is the risk the change accepts in exchange for adding nothing to vendor.
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
