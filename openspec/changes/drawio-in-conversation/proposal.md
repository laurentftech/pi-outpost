# Proposal

## Why

A `.drawio` diagram the agent writes only shows up in the file viewer: in the conversation
there is a path to click, while a Mermaid or structured-exchange diagram is drawn right in
the reply with its controls. The person who asked for this change wants to rebuild old
diagrams, exported from Visio or kept as SVG and pictures, as draw.io files they can reuse
and keep up to date. What the agent produces then needs small fixes: a box moved, a wire
re-routed or re-attached, a label corrected. Today each fix means a round trip through
draw.io desktop. It is installed, so the round trip is friction rather than a blocker,
which is why this change is about comfort.

The probe `scripts/probes/drawio-edit.mts` showed that the viewer we already ship,
jgraph's `viewer-static.min.js` (4.3 MB), bundles mxGraph's whole editing core, held back
by `setEnabled(false)`. Moving, reconnecting, drawing a wire, renaming and undo all worked
inside the existing sandboxed frame once it was re-enabled, with three small corrections.
Light editing therefore costs no new dependency. The full draw.io editor would add 20 to
30 MB, its own origin and its own release cadence.

## What Changes

- **A `.drawio` file in a reply is drawn in place.** The agent references it the way it
  already shows a workspace picture, `![label](./path.drawio)`, and the conversation draws
  the diagram in the same isolated frame as the file viewer, instead of a broken image.
- **Its controls match the Mermaid and structured-exchange displays**, in the same place
  and style (`DIAGRAM_ACTION`):
  - ⤢ enlarge;
  - ⤓ download SVG;
  - ⤓ download .drawio;
  - open in the file viewer.

  The file viewer's rendered `.drawio` mode gains the same enlarge and download controls.
- **Touch-up mode.** A "✎ touch up" control turns the drawn diagram editable. It is offered
  in the file viewer and in the enlarged view, but not in the small block inside the reply.
  The reader can:
  - move and resize boxes;
  - drag a wire's bends and re-attach its ends;
  - draw a new wire from a box;
  - rename a label in place;
  - delete a selected cell;
  - undo and redo.

  Saving writes the edited page back into the file and leaves every other page, the ids
  and the file's own settings untouched. Saving goes through the existing save path, so a
  file changed on disk meanwhile reports a conflict instead of being overwritten. Leaving
  touch-up mode with unsaved edits asks first.
- **The agent is told to show what it drew.** The `drawio` skill and `drawio_check`'s
  guidance say to reference the diagram in the reply once the check passes.
- **Not in this change:**
  - styling panels, shape libraries and new shapes from a palette: that stays draw.io
    desktop's job, behind "open in draw.io";
  - carrying a `.drawio` reference into the conversation's HTML and Word exports as a
    picture. Until then an export shows the reference as a link to the file, never as a
    broken image.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `drawio-diagrams`: adds drawing a referenced `.drawio` file in the conversation, the
  diagram controls (enlarge, SVG and `.drawio` downloads) wherever a diagram is drawn, and
  touch-up editing saved back to the file. The agent's guidance gains "show the diagram in
  the reply". The existing requirements stay as they are. Editing in draw.io desktop
  remains the path for anything beyond a touch-up.

## Impact

- `ui/src/util/drawioPage.ts`: the frame page learns touch-up mode and SVG export. Over
  the message protocol, the frame gains edit, save, undo/redo and export-SVG, and reports
  "edited" and "saved XML" back. Its CSP and sandbox stay as they are.
- `ui/src/components/DrawioFrame.tsx`: modes and the save hand-off.
- A new `DrawioBlock` component holds the controls and the enlarged view (`EnlargedView`).
  It is used by `AssistantMessage`'s `MarkdownImg` for `.drawio` sources and by
  `FileViewer`'s `.drawio` branch.
- `FileViewer.tsx`: touch-up saves go through `onSave` with its modification-time guard.
- `ui/src/export/*`: a `.drawio` image reference becomes a link in the HTML and Word
  exports.
- `skills/drawio/SKILL.md` and `server/src/drawioTool.ts`: guidance to show the diagram.
- Tests: the frame page (unit), `DrawioBlock` and `MarkdownImg` (component), and the
  running app via the bench, for both drawing and touch-up.
- No new dependency, and the vendored viewer is unchanged.
