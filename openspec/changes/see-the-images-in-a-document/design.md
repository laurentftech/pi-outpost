## Context

See proposal.md — Why. What shapes the approach here is where the pixels already are, which differs
by format and decides most of the work:

- `.docx` / `.pptx`: pictures are zip entries (`word/media/*`, `ppt/media/*`). Reading them needs the
  zip reader already in the tree and **no office application**. `readImageInfo` (`imageInfo.ts`)
  already reports a format and its dimensions; `rasterizeSvg` (`presentationRender.ts`) already turns
  an SVG into a raster.
- PDF: `pdf.ts` already walks each page's operator list with a transform stack (`collectShapes`, for
  strike detection), so the image operators and their placement sit on a path the code already
  travels. `rasterizePdf` already draws an arbitrary PDF page, verified against a scan fixture in this
  work: 1100×1424 PNG, canvas present, no conversion step.
- The tool protocol already carries interleaved text and image blocks — `docx_render` returns text
  plus several images today — so nothing new is needed to deliver pictures to the model.

The constraint that shapes the rest: extraction is currently **predictable**. Its cost is a function
of a document's text, and callers rely on that. Image bytes are not predictable, and a scan is
megabytes.

## Goals / Non-Goals

**Goals:**

- A caller always learns a picture is there, in the right place, at no extra cost.
- Picture bytes are obtainable, per picture, without an office application installed.
- A scanned page reaches the model at the resolution the file holds.
- Every gap is named — no picture, page, or encoding is passed over in silence.

**Non-Goals:**

- OCR, and therefore searchable text from a scan. See proposal.md — Impact.
- Layout truth from extraction: whether a table fits a page stays `docx_render`'s job.
- Turning native charts, SmartArt or grouped shapes into pictures. They are not pictures in the file;
  only a render shows them, and the specs keep naming them as unsupported visual content.
- Rasterising EMF/WMF.

## Decisions

### A marker, not markdown image syntax

Markers read as `[picture 3: PNG 800×600 — "Revenue by region"]` on their own line, not as
`![Revenue by region](image-3)`.

Markdown image syntax would invite a caller to treat the target as a path it can open or re-embed,
and an extraction is a *reading* of a document, not a document to re-render. A bracketed line also
survives `output_path`, where the extraction becomes a file someone reads. It matches the idiom the
extraction already uses for a page it cannot read as text (`_No text layer on this page…_`).

*Alternative considered*: an HTML comment carrying JSON, machine-exact but invisible to a person
reading the extracted file, and easy for a model to skip.

### Identifiers are the picture's position in document order

`picture 3` is the third picture the document draws. Stable for the same bytes, readable in a
sentence, and it does not leak a part name (`word/media/image7.png`) that would tempt a caller into
thinking it can open that path itself.

*Alternative considered*: the media part name — stable and unique, but it invites exactly that
mistake, and PDF images have no part name to use.

### One parameter: `images: "none" | "all" | string[]`

`"none"` is the default. `"all"` asks for everything within the budget. An array of identifiers asks
for named pictures, which is how a caller acts on a marker it just read, and how it retrieves one
picture too large to travel with its siblings.

*Alternative considered*: a separate boolean plus an id list — two knobs that can disagree. Also
considered and dropped: a `"referenced"` mode; the existing `pages`/`rows`/`blocks` parameters already
scope which part of the document is read, so pictures follow that scope with no third concept.

### Two ceilings, because one cannot do this job

- **Per call**: at most 8 pictures and 4 MB of image bytes, matching `MAX_RENDERED_PAGES` so the two
  ways of getting pixels cost comparably.
- **Per picture**: a single picture above roughly 2 MB *after encoding* is not returned under
  `"all"`. Its marker says it is available alone, by identifier.

Without the per-picture ceiling, one 300 dpi scan consumes the whole call budget and starves the
pictures after it; with it, `"all"` stays useful on a mixed document and the big one is still
reachable. Both are stated in the answer, never silent — the obligation the extraction already meets
for truncated text.

The ceiling is measured on the encoded bytes, not the decoded bitmap, which is what makes the
by-kind encoding above load-bearing rather than cosmetic: a photograph that would be 18 MB decoded
passes comfortably as JPEG, while a full-page 300 dpi scan of text stays a lossless PNG and may
still exceed the ceiling — correctly, because it is genuinely large, and it remains reachable alone.

### Marker volume is capped too

A deck of 200 screenshots would otherwise turn the text into a wall of markers. Past a threshold the
markers give way to a count for that page or section. This protects the default path, which is the one
every existing caller is on.

### PDF images are always re-encoded, and the encoding follows the bitmap's kind

Nothing can be passed through. This was checked before building on it, and it corrects what an earlier
draft of this document claimed: a PDF produced by Word carrying a genuine `/Filter /DCTDecode` image
comes back from `page.objs.get()` as `{ width: 240, height: 160, kind: 2, dataLen: 115200 }` — RGB at
24 bits per pixel, exactly 240×160×3. The original 15,003-byte JPEG is gone by the time the operator
walk can see it. Reaching the undecoded stream would mean going through the cross-reference table by
paths outside the surface `pdf.ts` uses, and fragile across pdfjs versions.

So every image is encoded on the way out, and the choice follows the `kind` pdfjs reports:

- **RGBA (32 bpp)** → PNG. The alpha channel requires it.
- **RGB (24 bpp)** → JPEG at quality 85. This is the photograph case, and it is the one that decides
  the budget: 18 MB of raw RGB for a 3000×2000 photograph, around 8–15 MB as PNG, under a megabyte as
  JPEG. PNG here would put nearly every photograph over the per-picture ceiling.
- **Grayscale / 1 bpp** → PNG. Small and lossless, which is exactly right for a scan of text, where
  JPEG's ringing around glyphs is the one artefact that would hurt reading.

*Trade-off accepted*: a photograph re-encoded to JPEG from an already-decoded bitmap takes a second
generation of loss. At quality 85 it is not visible at the job in hand, which is a model reading the
picture, and the alternative costs an order of magnitude in bytes.

*Alternatives considered*: always PNG — one format, lossless, but most photographs would then be
reachable only one at a time and still enormous. Downscaling above a pixel threshold — rejected
outright, because `ScannedPageIsItsOwnImage` requires the resolution the file holds, and that
resolution is the whole reason to look at a scan. Note that re-encoding does not touch resolution:
the pixels are preserved and only their container changes, so the spec is met as written.

### `pdf_render` is described as the second choice

The tool exists for a page with no text layer *and* no extractable image, and for "how does this page
look". Its description says so, and `pdf_extract`'s no-text-layer note names image extraction first
and drawing second. A tool whose description oversells it gets reached for by default — the failure
mode this project has already recorded, where the mechanism was right and the use of it was not.

### The `docx_create` alt-text fix ships here

`pptx_create` writes `descr` from a picture's alt text; `docx_create` writes `descr=""`. A marker with
no alternative text is worth much less, so the write-side fix belongs with the read-side work rather
than in a change of its own. The requirement governing `docx_create` lives in the `docx-templates`
capability, still inside the unarchived `add-docx-from-template` change, so no delta is written for it
here — see proposal.md — What Changes.

## Risks / Trade-offs

- **A caller asks for `"all"` on a picture-heavy document and floods its own context** → the two
  ceilings above, `"none"` as the default, and an answer that states what was left. An existing call
  cannot be affected: it never asks.
- **Identifiers shift when a document changes** → they are positional by design and documented as
  valid for the bytes just read, not as durable handles. Nothing stores them.
- **pdfjs decode gaps on exotic encodings** → named per image, never silent; the extraction still
  succeeds for everything else on the page.
- **Marker noise changes existing output** → this is a real change to what every caller sees by
  default, and the reason the marker is one compact line and capped by volume. It is also the point:
  silence about a picture is the defect being fixed.
- **A scanned page's image is enormous** → the per-picture ceiling keeps it out of a bulk request,
  and `pdf_render` remains the bounded-width way to look at the same page cheaply.
- **Two routes to a scan may confuse the caller** → tool descriptions and the no-text-layer note both
  order them explicitly; the spec forbids presenting drawing as the first route.

## Migration Plan

None required. No schema, protocol or file format changes; no parameter changes meaning; the new
parameter defaults to today's behaviour plus markers. `pdf_render` is additive. Rollback is reverting
the change.
