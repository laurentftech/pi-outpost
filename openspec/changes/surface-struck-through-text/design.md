## Context

See proposal.md — Why. What follows is the state of the two readers and the measurements the
approach rests on.

`server/src/docx.ts` walks `word/document.xml` with the streaming scanner in `xml.ts` and
accumulates text into two string arrays, `paragraph` and `cell`. It never opens `<w:rPr>`; the only
run-level element it reacts to is `<w:del>`, whose depth it counts so tracked deletions are dropped.
Text is joined, whitespace-collapsed and trimmed at flush time.

`server/src/pdf.ts` reads one thing per page: `page.getTextContent()`. Its items become `TextPiece`
values (text plus x, y, width, height), which `buildLines` groups into lines and `lineCells` splits
at wide gaps. Nothing in that pipeline sees the page's drawing operations.

### What the measurements say

Both claims below were checked against real files before this design was written, not inferred.

**A Word-produced PDF** (`/Creator (Microsoft Word)`), one page, after composing the CTM through
`save`/`restore`/`transform` and mapping each path's bounding box into page space:

| shape | x range | y | height | text baseline at that line | offset | what it is |
|---|---|---|---|---|---|---|
| filled | 90.1 → 99.1 | 599.0 | 0.5 | 595.4 (10 pt) | **+3.6** | strike over "1." |
| filled | 99.1 → 108.1 | 597.7 | 0.5 | 595.4 | **+2.3** | strike over the tab |
| filled | 108.1 → 272.6 | 598.5 | 0.5 | 595.4 | **+3.1** | strike over the sentence |
| filled | 490.7 → 535.7 | 657.0 | 0.25 | 657.7 (10 pt) | −0.7 | hyperlink underline |
| filled | 72 → 237.4 | 643.7 | 0.25 | 644.5 | −0.8 | hyperlink underline |
| filled | 161.3 → 276.4 | 107.0 | 0.5 | 108.3 | −1.3 | hyperlink underline |
| stroked | 72 → 548.3 | 475.6 / 158 | 0 | — | — | page rules |

Strikes land at ≈ +0.31 × font size above the baseline, underlines at −0.07 to −0.13 × size below
it. No overlap, and the gap is wide relative to the jitter. Word also splits its runs, so each
strike's x range coincides with text-item boundaries.

**A Chromium print-to-PDF** of the same shape confirms the primitive is not Word-specific — a filled
rectangle one unit high for both strike and underline — but Chromium emits a whole line as one
`Tj`, so a strike covering part of a line covers part of a text item. `disableCombineTextItems`
does not split it; the granularity is the producer's, not pdf.js's.

## Goals / Non-Goals

**Goals:**

- One marker vocabulary across both readers, so `~~` means the same thing whatever the file was.
- Detection that fails toward silence: a missed strike costs a marker, never text.
- No change to the tool signatures, the block model, or the caps.

**Non-Goals:**

- Resolving `styles.xml`. Only direct run formatting is read, so strikethrough applied through a
  character style is missed. Stated as a limitation rather than designed around.
- `/StrikeOut` annotations. No document seen so far uses them; adding a third source of truth for
  one hypothetical is not worth the surface.
- OCR, and any inference about text with no strike drawn over it.
- `pptx.ts` and spreadsheet cell formatting.

## Decisions

### D1 — DOCX: accumulate spans, render once, rather than emitting markers inline

The parser gets a third accumulator shape: instead of pushing bare strings into `paragraph`/`cell`,
it pushes `{ text, fmt }` spans, where `fmt` is the run's formatting. A single `renderSpans()` then
merges adjacent spans with equal `fmt`, moves leading and trailing whitespace outside the markers,
drops spans with no visible text, and wraps what is left.

Alternative considered: push `~~` into the array when `<w:r>` opens and again when it closes. It is
a smaller diff and it cannot satisfy the spec — a sentence split across five struck runs would come
out as five adjacent spans (`~~a~~~~b~~`, which GFM does not parse as one struck sentence), and a
run ending in a space would produce `~~text ~~`, which does not parse at all. Both are exactly the
cases Word produces, because Word splits runs at every formatting or language boundary.

Whitespace order matters: normalize inside each span first, then merge, then wrap. The existing
`.replace(/\s+/g, " ").trim()` at flush time stays, and is harmless once no marker has whitespace
against it.

### D2 — DOCX: toggle semantics, and `<w:rPr>` is not always a run's

`<w:strike/>`, `<w:strike w:val="true"/>`, `"1"` and `"on"` are on; `"false"`, `"0"` and `"off"` are
off. The off case is not hypothetical: a run inheriting strikethrough from its style turns it off
that way, and reading the element's presence alone would mark text the document shows unstruck.

`<w:rPr>` also appears inside `<w:pPr>`, where it describes the *paragraph mark* — the pilcrow —
not the runs. Word writes one there routinely. The walk therefore tracks `<w:pPr>` depth and ignores
any `<w:rPr>` inside it.

### D3 — DOCX: a fixed nesting order

Strike outermost, then bold, then italic. Struck bold is `~~**text**~~`; all three at once is
`~~***text***~~`, since `**` + `*` on the same word is written as three asterisks. Any order parses,
so the choice is arbitrary — what matters is that there is one, so the output is deterministic and
the delimiters stay balanced.

### D4 — PDF: a second read of the page, through `getOperatorList()`

`page.getOperatorList()` is the only API that exposes the drawn shapes. It is a second pass over the
same content stream, so it costs roughly what `getTextContent()` costs; it is issued inside the same
per-page deadline, and its failure is caught per page so a page that cannot be walked still returns
its text.

Alternative considered: render the page and look at pixels. It needs `@napi-rs/canvas`, which is
absent from the single-file build by design (see the `FallbackDOMMatrix` comment in `pdf.ts`), so
strike detection would work in one distribution and not the other. Rejected.

### D5 — PDF: CTM tracking, then a geometric filter

Path bounding boxes arrive in the current path space, and the text matrix is in page space; nothing
can be compared until they meet. The walk keeps a CTM, pushes it on `save`, pops on `restore`, and
post-multiplies on `transform` — six numbers and two operations, the same slice `FallbackDOMMatrix`
already covers. This was prototyped against the Word PDF and produced the table above.

A shape is a strike candidate when it is **filled** (not a stroked line), **thin** (height below
~0.25 × the font size of the text it covers), and **overlaps a line's x range**. It is classified by
the offset of its centre from that line's baseline, normalized by font size:

- offset < 0.10 → underline, ignored
- 0.10 ≤ offset ≤ 0.55 → strike
- offset > 0.55 → something else (a rule above the line, a box edge), ignored

The thresholds sit either side of a 0.18-wide empty band in the measurements, which is the margin
worth having. Stroked paths are excluded outright: the page rules in the sample are stroked and the
strikes are filled, and a border drawn as an outline is never a strike.

### D6 — PDF: the formatting lives inside the piece, not across several

`TextPiece` gains `spans?: Span[]` — its text broken into formatted runs. A strike covering ≥ 90 %
of a piece gives it one struck span, which is the Word case and needs no text surgery. Below that,
the covered x ranges are converted to indices at the word boundary nearest each proportional cut:
the producer gave us no per-glyph positions, so a word boundary is the most precise honest answer,
and rounding to it can only move a marker by part of a word.

Alternative considered, and written first: split the piece into several pieces, one per fragment.
Two things went wrong with it, both found by review rather than by a test.

A piece crossed by *two* separate strikes collapsed into one covered envelope, so live words between
two struck phrases were marked as struck — the exact opposite of what the marking claims. Keeping
the runs inside the piece makes each covered interval its own span, and the merge of intervals (as
opposed to a sum of their widths) also stops two overlapping rectangles from reporting more coverage
than the piece has and tipping it over the 90 % threshold.

And splitting lost whitespace: `lineCells` trims each piece and joins with one space, so `old   
current` came back as `~~old~~ current`, its spacing collapsed. Stripping the markers no longer gave
the text extraction returned before, which is the one thing this feature promises. With the runs
inside one piece, the trim applies to the piece's two outer edges as it always did, and everything
between them is the producer's.

Keeping the piece whole has a second benefit: `x` and `width` still describe what the producer drew,
so line building and column detection read the geometry they were written against.

### D7 — Fixtures are generated, not captured

`make-pdfs.mjs` writes PDF 1.4 by hand precisely so coordinates are known; a strike is `x y w h re
f` and an underline is the same rectangle lower down. `make-docx.mjs` gets a struck/bold/italic
document the same way. Committing the real Word file that prompted this would put third-party
content in the repo and give a test whose geometry we cannot vary.

The real Word PDF stays what it has been: the thing the thresholds were measured against, and the
file to re-check against by hand if the discriminator is ever changed.

### D8 — The strikethrough notice leads the extraction

Every other note these readers emit — no text layer, truncated, no table found — trails the content.
The strikethrough notice does not: it is the first thing in the markdown.

That is not symmetry for its own sake, it is a defect report. With the markers in place and the tool
descriptions updated, the change was tried in the running app: asked to read a document aloud, the
model transcribed the struck sentence as ordinary text and said nothing about it. Asked afterwards
whether anything was struck out, it found it immediately. The information was present and arrived
too late to change the answer.

A model answering a "read this" request works top to bottom and commits to its answer as it goes, so
a warning at the end is read after the answer exists. Leading with it costs one line of output on
documents that cross something out, and nothing at all on documents that do not.

The tool descriptions now also say to report struck passages when transcribing, quoting or
summarising. Both were changed together deliberately: the description is read once at session start,
the notice arrives with the content, and the failure was that neither existed.

## Risks / Trade-offs

- **A producer that draws strikes differently defeats detection** (a stroked line rather than a
  filled rectangle, or a strike at an unusual height) → falls back to no marker, which is today's
  behaviour. The spec makes that the contract rather than a bug: markers only ever add.
- **A false positive marks live text as struck** → the thresholds exclude the two shapes actually
  observed near text (underlines below the baseline, rules far from it), and require horizontal
  overlap so a marginal rule cannot reach a line. A false positive is still possible on a document
  that draws a highlight or a fraction bar as a thin filled rectangle over text; the cost is a pair
  of markers, and the text remains.
- **`getOperatorList()` roughly doubles per-page parse cost** → it runs inside the existing deadline
  and is measured in the task list before the change is called done. If a large document now trips
  the budget where it did not, that is a visible regression and the task list treats it as one.
- **Bold and italic markers change output for documents that already extracted cleanly** → they add
  `*` characters into prose the caller may be diffing. Accepted: the markers are what a reader needs
  to see the document's own emphasis, and the alternative is to keep flattening it.
- **A model may still not mention struck text** → the notice and the tool descriptions push against
  it, and neither can compel it. This is the one part of the change that cannot be closed by a test
  in this repository: it has to be re-observed in the running app after every change to either
  wording.
- **Character-style strikethrough stays invisible** → a document that crosses text out through a
  style, not a direct run property, extracts as it does today, with no warning. This is the one gap
  the change leaves open in its own subject; recorded here so it is a known limitation rather than a
  surprise.

## Migration Plan

None required. No stored data, no protocol change, no configuration. The change is additive to the
extracted markdown, and reverting the commit restores the previous output exactly.
