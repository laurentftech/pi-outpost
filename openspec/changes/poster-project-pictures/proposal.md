# A picture of the project in a poster

## Why
A poster can take a draw.io diagram of the project (`poster-drawio-pictures`), but not the
project's other pictures. A figure the agent wrote with `write_structure_figure`, an SVG exported
elsewhere, a PNG in the repository: the agent can only paste an SVG inline, against the guide's
rule and at the cost of reading all of it on every read of the poster. The person can insert a
picture only from their own computer, and an SVG is then turned into a PNG of at most 1200 px,
losing what made it worth having.

## What Changes
In pi-outpost, the same way as for draw.io diagrams:
- **Insert ▾ → Picture from the project…** lists the project's pictures (SVG, PNG, JPEG, GIF,
  WebP); the chosen one goes into the selected picture frame or onto the page.
- The agent lays out an empty picture frame naming a file, `data-picture-file`; the editor fills
  it when the poster opens, as an unsaved touch-up the person saves.
- An SVG is kept as it is, vector, so it prints sharp; a raster is scaled as a picture the person
  inserts is.
- The posters skill teaches such frames, the figures the agent writes among them.

## Impact
`posters/src/editor.ts`, `posters/src/frame.ts`, `posters/src/diagrams.ts`,
`web/src/posterEditorFrame.ts`, `ui/src/components/PosterFrame.tsx`, `ui/src/components/FileViewer.tsx`,
`skills/posters/SKILL.md`.
