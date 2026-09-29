## Context

See proposal.md — Why. Three facts shape the design:

- The annotations are one call away: `page.getAnnotations()` in the pdf.js already loaded by
  `pdf.ts`. No new parser, no new dependency.
- The extraction already holds every text piece of the page with its position (`toPieces`), because
  strike detection needs it. Recovering the text a highlight covers is the same geometry problem,
  already solved once in `markStruckPieces`.
- The extraction's existing contracts apply unchanged: a page budget in time, a character cap, page
  attribution, and honesty about what was derived from geometry.

## Goals / Non-Goals

**Goals:**

- A caller always learns that a document carries comments, before reading its content.
- Each comment arrives with who wrote it, when, what it says, and what text it is about.
- A discussion reads as one: replies under their comment, the review state on it.

**Non-Goals:**

- Placing comments inline in the text. See Decisions.
- Form fields, links, and the appearance of drawn markup (a circle, an ink scribble) beyond naming
  it as a comment with its remark.
- Comments in `.docx` files, and anything in the UI viewer.

## Decisions

### Comments follow the page's content, in a block of their own

Each page with comments ends with:

```
### Comments on page 3

- **Highlight** — Marie Dupont, 2026-09-12, on «the delivery date»:
  > To confirm with the client.
  - **Reply** — Paul Martin, 2026-09-13:
    > Confirmed by phone.
  - State: **Accepted** — Paul Martin, 2026-09-13
- **Suggested deletion** — Marie Dupont, 2026-09-12, on «in any event»
- **Note** — Paul Martin, 2026-09-14:
  > Missing the annex reference.
```

Order: by position on the page, top to bottom then left to right, using the annotation's `rect`.

Alternative considered: an inline marker in the text at the anchor, as pictures have. Rejected for
now. Text lines are rebuilt from pieces and can be merged into table cells; a marker inside that
path touches every mode's output and the table reconstruction for a feature that needs neither. The
quoted anchor already ties the comment to its text. An inline marker can be added later without
changing this block.

### The marked text is recovered from `quadPoints`, and quoted, never altered

For a text-markup annotation (`Highlight`, `Underline`, `Squiggly`, `StrikeOut`), each quadrilateral
is reduced to its bounding box. A text piece belongs to the anchor when the box covers most of the
piece's height and part of its width; a piece covered only in part contributes the characters under
the box, widened to word boundaries with the existing `wordBoundaryNear`. For a `Caret`, the anchor
is the word nearest the caret's `rect`.

The anchor is quoted in the comment's line and capped at 200 characters. It is never used to change
the page text: like strike marking, a wrong anchor costs a quotation, never content.

pdf.js's corner order within a quad is to be confirmed on a fixture before relying on it (task 1.2);
the bounding box is order-independent, which is why it is used.

### What counts as a comment

A comment is any markup annotation, which pdf.js marks by `MarkupAnnotation` and exposes by subtype:
`Text` (note), `FreeText`, `Highlight`, `Underline`, `Squiggly`, `StrikeOut`, `Caret`, `Ink`,
`Square`, `Circle`, `Line`, `Polygon`, `PolyLine`, `Stamp`, `FileAttachment`.

- Text markup and `Caret` are returned even without a remark: the mark is the message.
- Drawn shapes, stamps and ink are returned only when they carry a remark (`contentsObj.str` not
  empty). A bare doodle says nothing a reader can use.
- `Link`, `Widget` and `Popup` are never comments. A `Popup` only displays its parent's text, which
  the parent already carries.

Labels: Note, Text box, Highlight, Underline, Squiggly underline, Suggested deletion (`StrikeOut`),
Suggested insertion (`Caret`), Drawing (`Ink`), Shape (`Square`, `Circle`, `Line`, `Polygon`,
`PolyLine`), Stamp, Attachment.

### Replies and review states are rebuilt from `inReplyTo`

- An annotation with `inReplyTo` and `replyType` `R` is a reply, listed under the annotation whose
  `id` it names.
- `replyType` `Group` means the annotation is part of its parent, not an answer to it: it is not
  listed separately.
- A `Text` annotation with a `state` is a review state (`Accepted`, `Rejected`, `Cancelled`,
  `Completed`, `Marked`, `Unmarked`). It is shown as a state line on the comment it replies to, the
  latest one last.
- A reply whose parent is not among the page's annotations is listed at the top level, labelled as a
  reply, rather than dropped.

### Comment text is quoted so it cannot pass for structure

Comment text and author names are written by whoever annotated the file. They are document content,
as untrusted as the page text, and they SHALL NOT be able to pose as the extraction's own structure.
Every line of a remark is written as a blockquote under its list item, so a remark reading
`## Page 9` or `> Truncated` stays a quotation. Control characters are removed. Author names and
anchors are written on one line, their line breaks folded to spaces.

### Dates are shortened, and dropped when unreadable

PDF dates (`D:20260912143000+02'00'`) become `2026-09-12`. `modificationDate` is used, falling back
to `creationDate`. A date that does not parse is left out rather than shown raw.

### Comments come with the text; the notice leads in every mode

Comments are returned in `text` and `both`. In `tables` mode they are not returned, but the leading
notice still counts them and says that `mode: "text"` returns them: a caller asking for tables
learns the comments exist without paying for them.

The notice sits with the strike-through notice, before the first page, for the same reason: a
reader that works top to bottom must not be able to answer from the text without having read it.

### No parameter to switch them off

Alternative considered: a `comments` parameter, off by default. Rejected: the failure this change
fixes is a caller not knowing comments exist, and an off-by-default switch recreates it. The cost is
bounded by the caps below, and a document without annotations pays nothing but the
`getAnnotations()` call.

### Budget

- `getAnnotations()` runs inside the page's existing time budget, like `getTextContent()`.
- At most 50 comments per page and 2 000 characters per remark; past either, the block says how many
  were left out or that a remark was cut.
- The block counts toward the extraction's character cap like the rest of the page.
- A page whose annotations cannot be read still returns its text, and the page ends with a line
  saying its comments could not be read. The extraction does not fail.

## Risks / Trade-offs

- **Anchors on complex layouts.** Rotated text, multi-column pages and text drawn glyph by glyph can
  make the anchor imprecise. Mitigated by quoting it as derived, never touching the text, and by the
  fixture set covering a partial-word highlight and a highlight across two lines.
- **Word-exported PDFs.** They usually carry no annotations, so this change does nothing for them.
  The tool description should not promise more than the file holds.
- **Volume.** A document with thousands of annotations (an engineering drawing's markups) is held by
  the per-page cap and the character cap.

## Open Questions

- Whether `getTextContent()` ever includes a `FreeText` annotation's appearance text. If it does,
  the text box's words would appear twice. Checked in task 1.3.
