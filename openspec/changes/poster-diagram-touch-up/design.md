# Design

## Context

See proposal.md for why. What is already there:

- The poster editor runs in a frame (`web/poster-editor.html`) holding no credentials; it asks
  its parent, `PosterFrame`, for everything touching files (`posters/src/frame.ts`). Diagrams
  reach it through `PosterHost.diagrams`: `list()` and `draw(path, page?)`, the latter answered
  by `PosterFrame` reading the file, cutting the page (`drawioPage`) and drawing it in a hidden
  `DrawioFrame` (`DrawioPainter`).
- A diagram picture keeps `data-drawio` (path from the poster's directory, or from the root with
  a leading `/`) and `data-drawio-page` (a page's name, or its number from 1; absent = first).
- Touch-up exists: `DrawioBlock` drives `DrawioFrame`'s touch-up (save through the
  modification-time guard, undo, wire style, enlarged view, the "open in draw.io desktop"
  action). Its reply variant reads the file itself and follows it (`fileIo.onChanged`).
- Double-clicking an image runs the image type's `onActive`, which asks for a file.
- The viewer keeps the page it shows across redraws, and takes a starting page (`page`).

## Goals / Non-Goals

**Goals:** one touch-up, the file viewer's, reused as it is; the poster updated through the
drawing path it already has; nothing changes for hosts without diagrams.

**Non-Goals:** draw.io's full editor in the browser; detecting on open that a filled frame is
stale (proposal: a follow-up); editing a diagram from the agent's side.

## Decisions

### 1. The touch-up runs in the parent, over the editor frame

`PosterFrame` shows a full-size overlay holding `DrawioBlock` for the diagram's path, opened on
the named page and in touch-up straight away. The editor frame cannot host it: it reaches no
files, and the viewer must stay in its own opaque frame.

Rejected: opening the `.drawio` in the file viewer instead. The poster leaves the screen, and
coming back needs the viewer to tell the poster the diagram moved — the stale-frame follow-up,
not this change.

### 2. One long request: frame asks to edit, parent answers when the overlay closes

`PosterHost.diagrams` gains an optional `edit(path, page?) => Promise<boolean>`: resolved when
the touch-up closes, `true` when the diagram's file changed while it was open, rejected with the
reason when it could not be opened. One message, `DRAWIO_EDIT { id, path, page? }`, answered
`{ ok: true, value: changed }` or `{ ok: false, message }` like the other `DRAWIO_*`. No timeout
on the editor's side: the person may take an hour.

"Changed" is measured on the file, not on DrawioBlock's save button: its content when the
overlay closes against its content when it opened. That covers a save from the touch-up and one
from draw.io desktop (or the agent) alike, which is the point of `TheTouchUpFollowsItsFile`.

Rejected: the parent answering with the new SVG. The editor already has `draw(path, page)`;
drawing again through it keeps one path from file to picture, with its size bound and errors.

### 3. The editor redraws the page and replaces its pictures

When `edit` resolves `true`, the editor calls `draw(path, page)` and puts the result into every
image whose `data-drawio` and `data-drawio-page` name the same page as the double-clicked one:
same path string; same page string, an absent page and "1" being the same page. Two references
spelt differently (`./a.drawio` and `a.drawio`, a page by name and by number) are not matched —
said in Risks.

Each picture keeps its left/top and width; its height is set from the new SVG's proportions when
the element has a set height, left alone when its height is automatic. One undoable change; the
poster becomes dirty through the editor's usual tracking.

### 4. Double-click decides by the picture and the host

The image type's `onActive` triggers the editor's own handler, which opens the diagram when the
picture names one (`sourceOf` returns a diagram) and the host has `diagrams.edit`, and asks for a
file otherwise. Hosts without `diagrams` (Claude Desktop, Open WebUI) never reach the diagram
branch.

### 5. DrawioBlock opened on a page, in touch-up

Two optional props: `page` (name or number, resolved with `drawioPages` to an index, passed to
the viewer as its starting page in the RENDER message) and `startTouchUp`. The overlay uses the
reply variant's own reading, so it follows the file; DrawioBlock already holds a touch-up's
redraw until it ends (`DrawioFrame` holds a new `xml` back while editing), so an outside save
during unsaved touch-ups is not drawn over them, matching the requirement.

Closing the overlay goes through DrawioBlock's discard confirmation when touch-ups are unsaved.

## Risks / Trade-offs

- [The same page named two ways is not matched] → pictures the editor itself puts in use the
  spelling the diagram list gives; only hand-written markup differs. Matching by resolved path
  and page index would need the parent to resolve both; left for the stale-frame follow-up,
  which needs the same resolution.
- [Content compared at close reads the file again] → one read of a file already open; a read
  failure at close answers `false` and says why in the status line, leaving the poster as it was.
- [Poster closed or switched while the overlay is open] → the pending request is rejected
  ("the poster was closed"), like `draw` today; the overlay closes with the poster.
- [A second double-click while the overlay is open] → the overlay is modal; the editor ignores
  `edit` while one is pending.
- [The page is renamed or removed in the touch-up] → `draw` fails naming the page; the pictures
  are left unchanged and the status line says why.
