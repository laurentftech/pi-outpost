# Design

## Context

- `server/src/docx.ts` `parseBody` streams `word/document.xml` through `scanXml`. It counted
  `<w:del>` depth and refused `<w:t>` inside it. Deleted text sits in `<w:delText>`, which was never
  targeted.
- `<w:ins>` was not looked at: its runs passed through as ordinary text.
- `<w:moveFrom>` was not looked at either. Word writes a move's origin runs with `<w:t>`, not
  `<w:delText>`, so the origin was returned as well as the destination.
- `<w:rPr>` depth was counted outside `<w:pPr>` only. The `<w:rPr>` nested in a `<w:rPrChange>` was
  therefore read as the run's own formatting, and since it comes last in the run's properties, the
  *old* toggles won.
- Likewise, the `<w:pPr>` inside a `<w:pPrChange>` set `styleId` / `outlineLevel` to the old values.
  This is the fix listed in `AcceptedTextOnly`.
- `docxRestyle.ts` writes exactly these tracked formatting changes, so a document pi-outpost
  restyled is the most likely victim.
- A document edited in Office for the web shows a deleted table row as `<w:del/>` in the row's
  `<w:trPr>`, with the cells still holding ordinary `<w:t>` runs. An inserted row carries
  `<w:ins/>` there, and each cell's text has its own `<w:ins>`.
- Formatting is carried as `Span { text, format }` bit flags and rendered by `renderSpans`
  (`server/src/markdownSpans.ts`). That module merges adjacent runs with equal format and keeps
  whitespace outside markers.
- Output is a list of `DocxBlock`s rendered one by one. Block ranges, caps and `full` /
  `output_path` live in `extractDocx` and `docxTool.ts`.

## Goals / Non-Goals

**Goals:**
- One parse produces both readings. In the accepted reading, removed text is still counted, for the
  hint, but never emitted.
- The review layer is anchored to blocks, so ranges, caps and stable numbering fall out of the
  existing block model.

**Non-Goals:**
- Paragraph-mark revisions (two paragraphs merged or split with tracking) are not marked. The text
  of both paragraphs is still returned, as today.
- Cell-level insert/delete (`w:cellIns` / `w:cellDel`), numbering changes and section-property
  changes are not marked.
- Comments in headers, footers or footnotes, and revisions there, are not read: those parts are not
  read at all.
- No rendering of auto-numbering: heading numbers such as "4.2" are not in the text, today or after.

## Decisions

### Marker syntax: CriticMarkup subset, plus bracketed references

`{++ ++}`, `{-- --}` and `{== ==}` are CriticMarkup. It is documented and plain text, and models
have seen it.

The substitution form `{~~old~>new~~}` is not used. It collides visually with `~~` strikethrough,
and Word records a replacement as a deletion and an insertion anyway, so two markers say what the
document says. The inline comment form `{>> <<}` is not used either: comment bodies and threads can
be long and would break the flow of the text. The body goes in the closing list, and the anchor
carries `[cN]`.

References are `[rN]` for insertion/deletion, `[mN]` for a move (shared by both ends) and `[cN]` for
comments. Three prefixes let a reader tell kinds apart without the list.

Alternative considered: HTML-ish `<ins>` / `<del>`. Rejected because the extraction is consumed as
markdown and may be written to a `.md` file. Raw HTML there renders differently per viewer, and it
would need escaping of the document's own `<`.

### Markers are sentinels until the document's text is escaped

Markers are emitted during the walk as control-character sentinels, not as syntax. Each block is
rendered with its sentinels. Then the document's own `{++`, `++}`, `{--`, `--}`, `{==`, `==}` and
`[r1]`-shaped text is escaped, and only then do sentinels become syntax and final labels.

Escaping earlier, on each run, would miss a forged marker split across runs, since Word splits runs
freely. Escaping after real markers are in place could not tell them from forged ones. XML forbids
the two control characters, and the walk strips them from document text in case a lenient scanner
let one through. Table cells keep working, because `escapeCell` touches neither the sentinels nor
the escapes that come after it.

### Spans carry revision markers, not a new format bit

`Span` gains an optional `revision?: { open, close }` (the sentinels around its text, the reference
included in `close`) and `raw?: true` for zero-width markers such as a comment anchor. `renderSpans`
merges adjacent spans only when format *and* markers are equal, so one revision's runs merge and two
revisions never do. Revision markers wrap *outside* formatting markers: `{++**bold**++}`. Spans
without the new fields render exactly as before, so the PDF reader is unaffected.

### Grouping and numbering

Word gives each `<w:ins>` / `<w:del>` its own `w:id`, often one per run. A *revision* is a maximal
sequence of adjacent revised text of the same kind, author and date, within one paragraph: unrevised
text or a paragraph end closes it.

Moves are grouped by the `w:name` of `w:moveFromRangeStart` / `w:moveToRangeStart`, which links the
two ends. A table row whose `w:trPr` holds `w:del` or `w:ins` is one revision for all its cells. A
deleted row takes its cells with it, whatever their own runs say.

Groups get provisional ids during the walk. Final labels are assigned after it, by scanning every
block in document order for reference sentinels, before any block range is applied. A reference
therefore keeps its number in any range, and a revision of whitespace alone, which renders no
marker, gets no number.

### Comments

- `word/comments.xml` holds `w:comment` (`w:id`, `w:author`, `w:date`, body paragraphs). Bodies are
  read as plain text, paragraphs joined by " / ".
- Anchors in the body are `w:commentRangeStart` / `w:commentRangeEnd`. A `w:commentReference` with
  no range is a point comment. An anchor `{==` / `==}` opens when the first comment range opens and
  closes when the last one ends. It is closed and reopened at every paragraph boundary, so each block
  balances. The reference is written once, at the range's end.
- Threads and the resolved state live in `word/commentsExtended.xml`: `w15:commentEx` with
  `w15:paraId`, `w15:paraIdParent` and `w15:done`. They are linked through the `w14:paraId` of each
  comment's last paragraph.
  - Replies are folded into their root's entry, and their repeated anchors in the body are not
    marked.
  - Without the extended part, every comment is a root and its state is "not recorded".
- In the accepted reading, a damaged comments part costs the hint, never the document. In the review
  reading, it fails the call with that reason.

### Section attribution

Each reference records the block it first shows in; for a move, also its destination. After the
walk, a heading stack over the blocks gives each block its path, for example
`Exigences > Performances`. Heading blocks keep their accepted text without markers for this. A
reference before the first heading says so.

### Closing list format

The list comes after the content and before the truncation note, behind a `---` rule and the line
`Review layer, in document order:`. It has one line per reference shown:

```
- [r2] insertion — J. Martin, 2026-10-12 — Exigences > Performances
- [r3] table row deletion — J. Martin, 2026-10-12 — Exigences > Délais
- [m1] moved — A. Dupont, 2026-10-13 — from Exigences > Délais to Annexes
- [c1] comment, resolved — P. Leroy, 2026-10-14 — Exigences > Délais: « Pourquoi 45 ? »
    - reply — J. Martin, 2026-10-15: « aligné sur le marché »
```

The list is not counted against the per-call character cap, because it is bounded by the blocks it
belongs to and is never cut. A whole-document reading whose total passes the absolute ceiling is
still refused.

### Tool surface

`docx_extract` gains `review?: boolean`. The description says that the default is the accepted text
with a line counting what it hides, and what `review: true` shows. Comments leave the "not read"
sentence when `review` is set.

The default-reading hint ("This document holds 6 tracked changes and 1 comment that this reading
does not show … Pass review: true …") is a lead line after the strikethrough notice, which keeps its
place first. Counts are over the whole document, from the same parse.

`review` composes with `blocks`, `mode`, `full`, `output_path` and `images` without special cases.
With `mode: "tables"`, references in skipped paragraphs are not listed, because they are not shown.

## Risks / Trade-offs

- [Hand-built fixtures agree with the parser that wrote them] → one fixture,
  `docx-review-office-web.docx`, was edited in Office for the web. It holds:
  - an insertion and a deletion;
  - a replaced word in a table cell;
  - an inserted row and a deleted row;
  - an open comment on a heading.

  Desktop Word fixtures with moves and threads are still wanted (task 1.1).
- [Review output is larger: markers plus list] → it stays under the same caps, with truncation and
  `output_path`. The hint appears only when there is something to see.
- [Fixing `rPrChange` / `pPrChange` changes default output for restyled documents] → intended: the
  old output was wrong. The fix is called out in the PR, for the release changelog.
- [Weak models may not pick `review` for "what changed?"] → the hint is in the answer itself, where
  the cost is in front of the model. The agent-behaviour check (task 6.2) asks for an impact analysis
  in the running app and reads the transcript.
- [Author names are personal data] → they are in the user's own file, in the user's workspace, and
  are shown only on request. No new exposure.

## Migration Plan

None. The parameter is additive and the default reading keeps its contract, apart from the fixes
listed in `AcceptedTextOnly` and the hint line.

## Open Questions

- Whether the user's real cahier des charges contains revisions inside headers or footnotes often
  enough to warrant reading those parts later. Deferred, it does not change this design.
