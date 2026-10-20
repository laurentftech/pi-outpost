# Design

## Context

`drawio-diagrams` draws a `.drawio` file in the file viewer. The vendored jgraph viewer
runs in a frame with `sandbox="allow-scripts"` and a `default-src 'none'` policy
(`ui/src/util/drawioPage.ts`, `DrawioFrame.tsx`). The page in that frame is loaded once,
and each text is posted to it.

In a reply, `AssistantMessage`'s `MarkdownImg` turns a workspace-relative picture into an
`<img>` on `/files/raw`. A `.drawio` source therefore ends up as a broken image today.

Mermaid (`Mermaid.tsx`) and the structured-exchange view share their controls' look
(`diagramControls.ts`: `DIAGRAM_ACTION`, `DIAGRAM_ACTIONS`). They also share the
full-size overlay (`EnlargedView`, a portal out to the app's root), with
"⤢ enlarge" and "⤓ download SVG".

The probe `scripts/probes/drawio-edit.mts` holds the findings this design rests on (see
its header). In short:
- the viewer contains mxGraph's editing core, disabled;
- it replaces `graph.click` with a no-op;
- its in-place label editor needs a few rules of mxGraph's `common.css`;
- `mxCodec` keeps ids, attributes and geometry, but writes cells in tree order and drops
  the `<mxGraphModel>` attributes.

## Goals / Non-Goals

**Goals:**
- One drawing component for `.drawio`, used in replies, in the file viewer and in the
  full-size view, with one set of controls.
- Touch-up inside the existing frame, with its isolation unchanged.
- A save that rewrites only the page that was touched up.

**Non-Goals:**
- A palette of new shapes, style panels, or layers editing.
- Touch-up in the small block inside a reply, which is too cramped to aim at a wire's end.
- Collaborative or simultaneous editing of the same file by the reader and the agent.

## Decisions

### Touch-up uses the viewer's own mxGraph, not draw.io's editor

The alternatives:
- **jgraph's full editor in embed mode.** Either self-hosted, which means 20 to 30 MB of
  the 103 MB webapp, its own origin, `localStorage` and plugins to neutralise, and weekly
  releases to re-vet. Or `embed.diagrams.net`, which means network egress.
- **An editor of our own on top of our SVG.** That would redraw a subset differently from
  draw.io.

The viewer is the same drawing code as the editor, and the probe showed every gesture the
need calls for working in it. The trade is no styling UI, which stays in draw.io desktop.

### The frame page grows a mode, not a second page

`drawioFramePage` keeps one bootstrap and gains these messages from the parent:
- `EDIT { on }` turns touch-up on or off;
- `SAVE` asks for the page as XML;
- `UNDO` and `REDO`;
- `EXPORT_SVG`.

The frame answers with:
- `CHANGED { dirty }`, after each edit and after undo or redo;
- `SAVED { page, xml }`;
- `SVG { svg }`.

Turning touch-up on:
- calls `graph.setEnabled(true)`;
- deletes the viewer's `click` override;
- installs an `mxUndoManager` on the model and the view;
- binds Delete/Backspace, ⌘/Ctrl+Z and ⌘/Ctrl+Shift+Z inside the frame, since the
  keyboard focus is in the frame while editing.

Turning it off reverses all of this and redraws from the last text the parent posted, so
abandoned edits leave nothing behind. The rules of `common.css` the editor needs
(`.mxCellEditor`, `.mxPlainTextEditor`, `div.mxRubberband`) go in the frame's own
`<style>`. The CSP already allows inline style; the policy, the sandbox and the message
origin checks are unchanged.

### The splice is done by the parent, on the file's text, one page wide

The frame returns the shown page's `<mxGraphModel>` as `mxCodec` encodes it, together
with that page's index. Before encoding, the frame copies the page's original
`<mxGraphModel>` attributes (grid, page size…) back onto the model. Only the frame can do
this synchronously for a compressed page, since it holds the viewer's `Graph.decompress`.

A pure function in `ui/src/util`, `spliceDrawioPage(fileText, pageIndex, modelXml)`, then
locates the n-th `<diagram>` element in the text the save started from and replaces only
its content. The other pages stay byte-identical, and nothing round-trips through a DOM
serializer.

A compressed page that was touched up is written back uncompressed. draw.io reads both,
and the agent can then edit it as text. The alternative was to re-compress it to keep the
file's look; it was rejected because that would hide the page from the agent, which is
exactly what the `drawio` skill warns about.

Tree order is accepted. It is what draw.io itself writes, and the z-order inside each
parent is preserved.

### Saving goes through the existing write path and its guard

The file viewer already saves with `write_file` and an expected modification time
(`onSave(path, content, expectedMtimeMs)`), and reports conflicts. Touch-up records the
file text and modification time when it begins, and saves through the same call. A
refused save keeps the touch-up open with the conflict shown, and the reader can reload
or keep editing.

The full-size view opened from a reply gets a save function from `App` (`writeFile`,
which `FileViewer` already receives). The touch-up path therefore never needs the file to
be open in the viewer.

### One `DrawioBlock` for every place a diagram is drawn

`DrawioBlock` takes the file's path and text, and renders three things:
- `DrawioFrame`;
- a `DIAGRAM_ACTIONS` row with:
  - ⤢ enlarge;
  - ⤓ download SVG;
  - ⤓ download .drawio;
  - ↗ open, in a reply only;
  - ✎ touch up, outside a reply only;
  - open in draw.io, where the server can do it, as today;
- an `EnlargedView` with the same downloads and with ✎ touch up.

In touch-up mode the row becomes:
- save;
- undo;
- redo;
- done, which asks first if anything is unsaved.

`FileViewer`'s rendered mode and `MarkdownImg` both use the block. `MarkdownImg` branches
on the `.drawio` extension (`isDrawio`) before building an `<img>`.

### A reply's diagram reads the file and follows it

`MarkdownImg` cannot hand text to a frame. The block fetches the file through the same
raw endpoint images use (`rawFileUrl`, with the token and workspace), as text.

It refetches on the `file_changed` broadcast for its path. `useAgent` already receives
that broadcast and acts on it only for the open file. It will expose a small per-path
subscription (`onFileChanged(path, cb)`) so that each block refetches its own file and
nothing else re-renders. A failed fetch, or a text the viewer reports as unreadable,
shows the message naming the file instead of the frame.

Frames mount only once the block nears the viewport (IntersectionObserver). A long
conversation holding many diagrams therefore does not parse the 4.3 MB viewer once per
diagram up front.

### SVG download from the frame, of the page shown

The frame answers `EXPORT_SVG` with `graph.getSvg(...)` of the current page. draw.io's own
export writes HTML labels as `<foreignObject>` inside a `<switch>` with a plain `<text>`
fallback, which is how its exports read in tools that ignore `foreignObject`. The parent
names the file after the `.drawio` file and the page (`architecture-Overview.svg`) and
downloads it the way Mermaid's control does. "⤓ download .drawio" downloads the text as it
was last read, under its own name.

### Exports carry a link

The HTML and Word conversation exports resolve pictures through
`ui/src/export/loadReferencedImage.ts`. A `.drawio` source becomes a link with the file's
name instead of a picture lookup. Drawing it as a picture in exports is a separate change
(see proposal).

### The agent is told to show the diagram

`skills/drawio/SKILL.md` gets the following step: after `drawio_check` passes, put
`![<name>](./<path>.drawio)` in the reply. `drawio_check`'s `promptGuidelines` say the
same in one line. The skill's step 4, "tell the user where the file is", becomes this.

## Risks / Trade-offs

- **The viewer's internals are not an API.** The `click` override, `setEnabled` and the
  class names could move in a jgraph release.
  → `update-drawio-viewer.mjs` already asks for a check in the running app. The frame's
  unit test asserts the editing globals exist (`mxUndoManager`, `mxCodec`,
  `Graph.prototype.getSvg`), and the e2e drives the gestures, so a release that breaks
  them fails CI rather than a reader.
- **The plain label editor flattens rich labels.** Retyping a label that held `<br>` or
  bold loses them.
  → Try mxGraph's rich editor (`html=1` cells get a content-editable editor when the
  stylesheet is there) during implementation. Otherwise, document the limit in the skill
  and keep the label's HTML when the reader confirms it unchanged.
- **Clicking inside a container selects the container,** as in draw.io. A reader aiming at
  a thin wire can hit the lane instead.
  → mxGraph's tolerance and the visible handles make this the same as in draw.io desktop.
  No custom picking.
- **A frame per diagram in a reply** costs memory on long conversations.
  → Frames mount near the viewport; the browser caches the script.
- **SVG in Word desktop.** Desktop Word is the target that matters, and it ignores
  `foreignObject`.
  → The `<switch>` fallback should carry the labels; send a sample file for checking in
  Word, since Word is not available on the dev Mac.
- **The agent rewrites the file mid-touch-up.** The save refuses on the modification time,
  so the reader loses nothing silently, but the reader has to redo the touch-up on the new
  text.
  → Acceptable for a touch-up; the conflict message says what happened.

## Migration Plan

Nothing to migrate. Rollback means reverting the change. Files touched up by it are
ordinary `.drawio` files, with any touched-up page uncompressed.
