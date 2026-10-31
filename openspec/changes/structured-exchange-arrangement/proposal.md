# Proposal

## Why

Structured-exchange graphs are hard to put in a Word or PowerPoint deliverable. Their wires are
curves through dagre's waypoints. Several flows can leave one point, and labels can land on one
another. A box moved by hand drags the curves out of shape, and the arrangement is thrown away:
the next figure, and every export, start again from the automatic layout. draw.io diagrams in
pi-outpost reach a clean result on the same kind of content. Their wires are orthogonal,
`drawio_check` points at what is wrong, and touch-up fixes it.

The real cost comes later. When the chief engineer asks for a modification, the figure is laid
out again from scratch. Every manual fix has to be redone, and the old and new figures compared by
eye to find what moved.

## What Changes

- **Orthogonal wires.** Relationships in a structured-exchange graph are routed orthogonally, by
  the draw.io routing pi-outpost already ports and checks against the real viewer. The UI and the
  browserless export share one routing, so they still cannot disagree.
- **Cleanup by the wire rules.** The automatic placement is cleaned up by the rules drawio_check
  applies: one point per flow unless the label is the same, ends on facing sides, no needless
  bend, labels clear of labels and wires. The values each rule proposes are applied until nothing
  is left to fix, as drawio-wire-anchors proved for followed advice.
- **A versioned arrangement file.** It sits beside the document and records, per viewpoint, where
  boxes are, which sides wires leave and enter, their waypoints, where labels sit, and the
  orientation. Entries are keyed by the identities the document gives its elements and
  relationships. The file is partial: what it does not name is computed. It is presentation
  only. It is not part of the exchanged document and is never carried back to an authority.
- **Incremental placement.** When the document changes, what the arrangement places stays where it
  is. A new element is placed near what it relates to, moving others only when it must. A
  removed one leaves its place empty. Only the wires an addition, removal or move touches are
  routed again and cleaned up.
- **Arrangement check.** The arrangement is checked against the document. The check lists what is
  left for a person to look at (a wire through a box, a shared point the rules could not separate,
  an entry naming nothing that still exists), in the drawio_check style, with values.
- **Arranging by hand through draw.io touch-up.** A figure can be opened as a `.drawio` diagram and
  touched up with the existing touch-up (move boxes and wire ends, remove bends). Saving reads
  positions, sides, waypoints and label places back into the arrangement, by identity.
- **Figures use the arrangement.** Figures the reader downloads and figures the agent writes both
  use the arrangement, so a figure in Word or PowerPoint desktop is the arranged one.
- Out of scope, for a second change: marking structural changes (review vs clean version) and
  updating a figure in place inside an existing Word or PowerPoint document.

## Capabilities

### New Capabilities

- `structured-exchange-arrangement`: the presentation arrangement of a structured-exchange graph.
  This covers the file, keyed by identity and per viewpoint, the orthogonal routing and the wire
  cleanup, incremental placement when the document changes, the check of what is left, and the
  round-trip through draw.io touch-up.

### Modified Capabilities

- `structured-exchange`:
  - `AFigureCanBeProducedWithoutABrowser` takes the arrangement as an input beside the document
    and the narrowing, and stays deterministic with it.
  - `ReaderMayAdjustAndNarrowTheView` lets a repositioning be kept in the arrangement. It still
    never alters the document and is never carried back.
- `structured-exchange-viewpoints`: `TheAgentCanWriteAFigureForAViewpoint` draws a viewpoint with
  that viewpoint's arrangement.

## Impact

- `shared/src/structuredExchangeModel.ts` (`layoutGraph`, `edgePath`) and
  `shared/src/structuredExchangeFigure.ts`: orthogonal routes, placement that respects fixed
  positions, label places.
- Routing and wire rules move from `server/src/drawioRoutes.ts` and `server/src/drawioAnchors.ts`
  (and the label and same-line rules in `server/src/drawio.ts`) into `shared/`, so the browser
  draws with them too. The server keeps importing them for drawio_check.
- New: the arrangement format and its schema, reading and writing, incremental placement, the
  check, and `.drawio` generation and read-back.
- `ui/src/presentations/StructuredExchangeView.tsx`: drawing from the arrangement, saving a move,
  opening in touch-up. The structured-exchange figure tool reads the arrangement.
- Depends on drawio-wire-anchors (PR #389) for the wire rules and the touch-up bend removal.
- Word and PowerPoint receive the figure as today (SVG, rasterised where needed). It is judged in
  the desktop applications.
