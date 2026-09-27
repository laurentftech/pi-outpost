## Why

The agent reads documents blind to their pictures. `docx_extract` and `pptx_extract` drop every
image without a trace in the text — their descriptions say so, but an agent summarising a report
cannot know it missed the chart the report was written around. A scanned PDF is a dead end: the
extraction reports "OCR is not available" and stops, with no second sentence.

The one existing route to pixels is a whole-page render, and it answers a different question.
`docx_render` exists to check a document *we wrote* — does the table fit the page, did the numbering
come out right. Using it to look at a picture is the wrong instrument: it needs Word, LibreOffice or
ONLYOFFICE installed, costs a page-sized raster (90–115 KB per page, measured), caps at 8 pages, and
downscales every picture to fit 1100 px. A photograph or a dense diagram arrives unreadable.

Meanwhile the pictures are already within reach. In `.docx` and `.pptx` they are plain zip entries
(`word/media/*`, `ppt/media/*`) — no office suite required at all. In a PDF, `pdf.ts` already walks
the operator list with a transform stack to find drawn shapes, so the images and their positions sit
on a path the code already travels. A scanned page *is* an image, and extracting it gives the scan at
its own resolution — 200–300 dpi rather than a re-rasterised 1100 px.

## What Changes

- **Extraction marks where a picture sits.** `docx_extract` and `pptx_extract` place a marker in the
  text at the picture's position, carrying its alt text when the file has one, its format and its
  dimensions. This alone ends the silent omission, and it is what makes the rest discoverable.
- **The bytes travel only when asked for.** A new `images` parameter — `"none"` by default, `"all"`,
  or a list of the identifiers the markers carry — returns pictures as image content blocks. A byte
  and count budget caps what one call returns, and the answer names what was left and how to ask for
  it — the idiom the tools already use for text (`full`, `rows`, `pages`). See design.md — Decisions
  for why there is one parameter and not two.
- **Vector pictures are rasterised or named.** SVG goes through the existing `rasterizeSvg`. EMF and
  WMF — common in Word documents from the enterprise — have no rasteriser here and SHALL be named as
  present-but-unreadable rather than dropped.
- **`pdf_extract` returns a page's own images**, including the single image that is a scanned page,
  at the resolution the file holds. Encodings that are not directly viewable (JBIG2, CCITT, JPX) are
  decoded through the canvas already in the tree, or named when they cannot be.
- **A new `pdf_render` tool** draws a PDF's pages as pictures, reusing `rasterizePdf` unchanged. It
  is the fallback, not the headline: for a page with no extractable image (a vector-drawn export, a
  map, a CAD plot), and for "what does this page actually look like".
- **The scan note becomes actionable.** Where `pdf_extract` reports no text layer it names the tool
  that can see the page. Today it reads as a dead end, and an agent stops there.
- **`docx_create` carries alt text.** Markdown `![alt](src)` currently writes `descr=""`, so a
  picture the agent placed comes back with no description — including through the new marker.
  `pptx_create` already writes it. This is a write-side fix with no main spec of its own yet: the
  capability that governs `docx_create` (`docx-templates`) still lives in the unarchived
  `add-docx-from-template` change, so the requirement is recorded here as a task and belongs in that
  capability when it archives.

Nothing is removed and no default changes: an existing call to any extractor returns what it returns
today, plus markers in the text.

## Capabilities

### New Capabilities

None. `pdf_render` is a new tool, but it belongs to the existing `pdf-documents` capability — reading
a PDF the workspace already holds.

### Modified Capabilities

- `docx-documents`: extraction marks each picture in place with its alt text, format and size, and
  returns picture bytes on request under a stated budget; unreadable vector formats are named.
- `pptx-documents`: the same for slides, where a picture already counts as content a slide may hold
  nothing but.
- `pdf-documents`: extraction returns a page's images, a scanned page included, at the file's own
  resolution; the no-text-layer note names what can see the page; a `pdf_render` tool draws pages as
  pictures for what has no extractable image.

## Impact

- **Reading**: `server/src/docx.ts`, `server/src/docxTool.ts`, `server/src/pptx.ts`,
  `server/src/pptxTool.ts`, `server/src/pdf.ts`, `server/src/pdfTool.ts`.
- **New tool**: `pdf_render`, registered alongside the other document tools in `server/src/index.ts`.
- **Reused unchanged**: `rasterizePdf` and `rasterizeSvg` (`server/src/presentationRender.ts`),
  `readImageInfo` (`server/src/imageInfo.ts`), the operator-list walk in `server/src/pdf.ts`.
- **Writing**: `shared/src/docx.ts` for the `docPr descr` attribute.
- **Context budget** is the material risk: extraction is predictable today, and image bytes are not.
  The budget, the default of `"none"`, and the "what was left" note are what keep an innocuous call
  from exploding. `MAX_IMAGES` and `MAX_IMAGE_BYTES` already exist in `server/src/index.ts` for the
  prompt side and set the ceiling to respect.
- **No new dependency.** Everything needed — pdfjs, the canvas, the zip reader — is already present.
- **Not addressed**: OCR. Vision reads a scan; it does not make it searchable text. A bulk archive
  that needs searchable text is a different project, and adding a native OCR dependency here would
  be out of proportion to this one.
