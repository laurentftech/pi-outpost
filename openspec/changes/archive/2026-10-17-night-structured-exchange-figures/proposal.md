# Structured-exchange figures follow the dark theme

## Why

Graphs, sequences and timelines kept their white ground on a dark page: a bright
block in the conversation, where a Mermaid diagram beside them follows the theme.
The role key above a table was hard to read in both themes — a pastel square the
size of a letter, and in the dark theme no colour at all.

## What Changes

- On screen, every colour a figure carries is also given as `light-dark(day, night)`.
  The night colour is derived (OKLab lightness mirrored around the ground, hue and
  chroma kept), so palette colours and a project's declared kind colours both have one.
  The white ground becomes zinc-900, the ground of a Mermaid diagram at night.
- The figure's attributes stay the day colours: a downloaded or copied figure, and the
  figures written into documents, are the same light picture whatever the theme.
- The timeline's frame (labels, legends, controls, details) gains dark variants.
- The table's role key swatches are outlined in the role's colour, in both themes.

## Impact

`ui/src/presentations/nightPaint.ts` (new), `figureDrawing.tsx`, `TimelineView.tsx`,
`StructuredExchangeView.tsx`. No change to `shared/` figure computation, the
serializer, the server or the contract.
