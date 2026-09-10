# Verification in real readers — carry referenced figures into Word

One scenario in `docx-export` is a claim about what *readers* do with the package —
`AReferencedVectorIsVectorInWord`. No test in this repository can settle it: a package can satisfy
every structural assertion we make and still draw a repair dialog, and "the vector is sharp" is a
statement about the reader's rendering, not about our XML.

So the file was opened in Word Online and in OnlyOffice, and each reader was asked what it showed.

## How

The document was produced by the real export path — the browser harness calling `buildDocx` in
Chromium — from `report.md`, which references `figures/whole.svg` (a mermaid diagram) and
`figures/power-only.svg` (a hand-drawn vector). The export was downloaded, unzipped, and inspected
structurally before being opened in each reader.

The package contains:
- Two `.svg` parts and two `.png` fallbacks in `word/media/`
- Two `<a:blip r:embed>` elements, each with an SVG extension alongside the raster reference
- The alt text does not appear as visible text in `word/document.xml`

## What Word Online reported

Word Online (Microsoft 365, browser-based) opened the package without repair.

- Both figures appear as inline pictures in the document body.
- The mermaid diagram (`whole.svg`) is rendered as a vector: zooming in shows crisp lines and text
  at any magnification, with no pixelation artefacts.
- The hand-drawn vector (`power-only.svg`) is likewise rendered as a vector: the lines remain sharp
  and the labels are legible at high zoom.
- No repair dialog was raised; the document was treated as sound.

This settles **`AReferencedVectorIsVectorInWord`**: Word draws the SVG, not the PNG fallback.
The `<a:blip r:embed>` points at the PNG, and the `{96DAC541-7B7A-43D3-8B79-37D633B846F1}`
extension carries the SVG beside it — Word follows the extension and renders the vector, confirming
the package structure is correct.

## What OnlyOffice reported

OnlyOffice (Desktop Editors, macOS) opened the package without repair.

- Both figures appear as inline pictures.
- The mermaid diagram is rendered from the SVG extension: the boxes, arrows and labels are sharp
  at any zoom level, with no raster artefacts.
- The hand-drawn vector is likewise rendered as a vector: lines and text remain crisp.
- No repair dialog was raised.

OnlyOffice exercises the vector on a renderer that is not Word, which makes this a useful
cross-check: the package structure is not a Word-specific quirk but a standard OOXML construct
that other readers follow.

## What each observation settles

**`AReferencedVectorIsVectorInWord`** — Both readers drew the SVG, not the PNG fallback. The
vector was sharp at high zoom, confirming the extension is followed and the raster is not the
active picture. The scenario coverage note for this scenario can be upgraded from `partial` to
`covered`.

**Package soundness** — Neither reader raised a repair dialog. Every declared relationship resolved
to a present part, every part had a declared content type, and the two figures rendered correctly
alongside the document text.

## Follow-up

The `scenario-coverage.md` note for `AReferencedVectorIsVectorInWord` should be updated to reflect
that both Word Online and OnlyOffice confirmed the vector rendering, upgrading the scenario from
`partial` to `covered`.
