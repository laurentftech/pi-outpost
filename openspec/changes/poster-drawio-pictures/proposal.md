# A draw.io diagram in a poster

## Why
Asked to put a draw.io diagram in a poster, the agent could not: it has no way to draw the
diagram, and the poster guide rightly forbids text inside a drawing. The person had to export
an SVG themselves and hand it over, and the SVG then sat inline in the markup, read in full by
the agent on every read of the poster.

draw.io's own viewer, which pi-outpost already serves to show `.drawio` files, draws a page as
an SVG. It needs a browser: it measures text in the DOM, so the server cannot do it without
shipping a browser. Checked in Chromium: that SVG shown as a poster picture
(`<img src="data:image/svg+xml;base64,…">`) draws whole, HTML labels included, and survives the
poster's Word and PowerPoint export, which paints the page through a foreignObject.

## What Changes
In pi-outpost, where the viewer is served and the project's files are at hand:
- **Insert ▾ → draw.io diagram…** lists the project's diagrams and their pages; the chosen page
  is drawn by the viewer in the browser and put in the poster as an SVG picture, into the
  selected picture frame or onto the page.
- The agent lays out an empty picture frame naming a diagram, `data-drawio` (and
  `data-drawio-page`); the editor fills it when the poster opens, as an unsaved touch-up the
  person saves. The agent never handles the SVG; it reads the picture as a marker like any other.
- The posters skill teaches the agent such frames.

Not in this change: redrawing a filled frame when its diagram changes later; the other hosts
(Claude Desktop, Open WebUI), which do not serve the viewer.

## Impact
`posters/src/editor.ts` (an optional host capability, a menu item, filling frames on open),
`posters/src/frame.ts` (two messages), `web/src/posterEditorFrame.ts`,
`ui/src/components/PosterFrame.tsx` (drawing through a hidden `DrawioFrame`), `ui/src/fileIo.ts`
and `ui/src/useAgent.ts` (finding files by name), `skills/posters/SKILL.md`.
