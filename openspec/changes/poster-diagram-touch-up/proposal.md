# Touch up a poster's draw.io diagram from the poster

## Why

A draw.io diagram put in a poster (poster-drawio-pictures) is a picture of one page, frozen when
it was drawn. To correct it the person has to leave the poster, open the `.drawio`, touch it up,
come back — and the poster still shows the old picture, since only empty frames are drawn when
it opens. Double-clicking the diagram meanwhile offers to replace it with a file of their own,
which is never what they want on a diagram. Asked directly: "on ne peut pas modifier le draw.io
quand on l'a mis dans un poster".

## What Changes

In pi-outpost, where the editor's host can read, draw and write the project's diagrams:

- Double-clicking a picture drawn from a diagram (`data-drawio`) opens that diagram's page for
  touch-up over the poster — the same touch-up as the file viewer (move boxes, re-attach wires,
  fix labels, wire style, undo, save), with draw.io desktop one click away for anything more.
- Closing it after a save puts the page as now drawn back into the poster: in that frame, and in
  every other frame showing the same page. The frame keeps its width; its height follows the
  page's new proportions. The poster has unsaved changes, saved as any other.
- While it is open it follows the file: a save made from draw.io desktop meanwhile is drawn, and
  is what closing it puts in the poster.
- Double-clicking any other picture, or any picture in a host that cannot edit diagrams (Claude
  Desktop, Open WebUI), still asks for a picture file.

Not in this change: noticing, when a poster opens, that a filled frame's diagram has changed
since it was drawn (by the agent, or in draw.io desktop without going through the poster) — a
follow-up, which would mark the frame and offer to redraw it rather than change the poster
silently. Nor draw.io's full editor in the browser: touch-up plus draw.io desktop covers it.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `poster-elements`: `ASlotIsFilledByDoubleClick` — a picture drawn from a diagram, in a host
  that can edit diagrams, opens the diagram rather than asking for a file.
- `poster-files`: a diagram in a poster is touched up from it, and the poster takes the page as
  saved. Builds on poster-drawio-pictures, whose requirements this capability gains when that
  change is archived; this change must be archived after it.

## Impact

- `posters/src/editor.ts`: double-click on a diagram picture asks the host; replacing the frames
  showing a page with its new drawing. `PosterHost.diagrams` gains an optional `edit`.
- `posters/src/frame.ts`, `web/src/posterEditorFrame.ts`: one message, frame → parent, answered
  with the page's new drawing or nothing.
- `ui/src/components/PosterFrame.tsx`: the overlay holding the touch-up, drawing the page after
  it closes; `DrawioBlock` (or its touch-up) opened on a given page, following the file.
- Claude Desktop (`mcp/`) and Open WebUI (`openwebui/`): no change; their hosts have no
  `diagrams`.
- Tests: editor unit tests, `FileViewer.poster.test.tsx`, e2e in pi-outpost's file viewer.
