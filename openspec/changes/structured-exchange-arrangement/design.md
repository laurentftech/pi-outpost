# Design

## Context

How a graph is drawn today:

- `layoutGraph` (`shared/src/structuredExchangeModel.ts`) hands the whole graph to dagre. Dagre
  returns box positions and a waypoint list per edge.
- `edgePath` joins those waypoints into rounded curves and puts the label at the middle waypoint.
- The figure is computed once, as data, in `shared/src/structuredExchangeFigure.ts`. React draws it
  in the browser, and a serialiser writes it as SVG for the agent's figure tool. That shared
  computation is what lets the two never disagree (`AFigureCanBeProducedWithoutABrowser`).
- A reader's move is kept as a nudge, an offset from the computed layout. Nudges live in component
  state. They are dropped when the layout changes and never saved. `edgePath` warps a route along
  with its moved ends, which is where routes get distorted.

On branch drawio-wire-anchors (PR #389), pi-outpost has:

- a port of draw.io's routing, `server/src/drawioRoutes.ts`, checked against the vendored viewer in
  e2e;
- the wire rules, in `server/src/drawioAnchors.ts` and the label and same-line rules in
  `server/src/drawio.ts`, whose advice converges when followed (`server/test/drawioFollowAdvice.ts`);
- a touch-up that moves boxes and wire ends and removes bends.

Everything in that list lives under `server/`. The browser cannot use it yet.

## Goals / Non-Goals

**Goals:**
- One routing and one cleanup, used by the UI view, the figure tool and the draw.io round-trip.
- An arrangement file a person can version, whose diffs are as small as the change made.
- Placement that leaves arranged things alone.

**Non-Goals:**
- Sequences, timelines and tables keep their layouts. This change is about graphs.
- No editing of the document through draw.io. Content stays the document's.
- Structural change marks and in-place document update belong to the second change.
- No new routing algorithm. The port is used as it is, rules included.

## Decisions

### 1. The figure becomes a draw.io page internally

A graph's placement is expressed as the cells a draw.io page would have:

- each element is a vertex with its box;
- each relationship is an `edgeStyle=orthogonalEdgeStyle` connector, with optional
  `exitX/exitY/entryX/entryY`, waypoints, and a label offset;
- each container is a vertex holding its members.

`routeWire` routes it, and the wire rules check it, unchanged.

- *Why:* one model serves three needs. The routes are the viewer's by construction, so the e2e that
  compares the port with the viewer covers this change too. The rules apply without an adapter. The
  `.drawio` for touch-up is a serialisation of the same cells, not a translation.
- *Alternative:* a separate orthogonal router for structured-exchange. That would be a second router
  to keep in step with draw.io, which is exactly the drift `AFigureLeavesAsOneFile` was written to
  prevent.

### 2. The routing and the rules move to `shared/`

`drawioRoutes.ts`, the rule functions of `drawioAnchors.ts`, the label and same-line rules of
`drawio.ts`, and the advice follower now in `server/test/drawioFollowAdvice.ts` all move to
`shared/src/drawio/`. The server imports them from there for drawio_check.

- *Why:* the figure is computed in `shared/`, in the browser as much as on the server.
- They hold no Node API today: routes and rules are geometry over parsed cells. Moving them is a
  module move, guarded by the existing suites and the routes e2e.

### 3. The arrangement file

- **Location:** `<document>.arrangement.json` beside the document.
- **Header:** it declares `"format": "pi-outpost/structured-exchange-arrangement-1"`. The document
  detector tests for a structured-exchange `schema`, which the arrangement never carries, so it is
  never read as a document.
- **Shape:** `views` is keyed by viewpoint identifier, with `""` for the whole document. Each view
  holds `orientation`, `elements` (key → `{x, y}`) and `relationships` (key →
  `{exit?, entry?, waypoints?, label?}`).
- **Positions are absolute,** in figure units, snapped to the grid of 10. Today's nudges are
  offsets against a layout that changes with the document, which is why they cannot survive a
  change. Absolute places do.
- **Element keys:** `ref:<reference>` when the element carries a reference, otherwise
  `id:<envelope id>`. References are opaque and are written verbatim (JSON escaping only).
- **Relationship keys:** `ref:<reference>` when there is one, otherwise the endpoints' keys, the
  kind, and the rank among relationships sharing those three. A relationship's endpoints are its
  identity in the contract ("re-attaching is a removal plus a creation"). Its label is state, so a
  relabelled relationship keeps its route.
- **Stable text:** keys are sorted, numbers are integers or four-decimal fractions, the indent is
  2 spaces, and the file ends with a newline. The same arrangement is the same bytes, and a moved
  box is a one-entry diff.
- *Alternative:* store the arrangement inside the document. Rejected: it would change the
  exchanged contract (a v3 envelope) and travel to the authority, which `ReaderMayAdjustAndNarrowTheView`
  forbids.

### 4. Incremental placement

Starting from the view's arrangement:

1. **Keep what is arranged.** Arranged boxes are fixed.
2. **No arrangement at all:** dagre lays out the graph as today. Its positions become the
   starting places, and routes come from `routeWire`. draw.io's orthogonal routing does not
   avoid shapes, while dagre's routes do. So a relationship whose straight route would cross
   another box gets dagre's interior points as waypoints, and the others get none. The cleanup
   then removes the bends this leaves for nothing.
   - Parallel relationships get their own points on the facing sides, as many as the side has
     room for at 10 units apart. The rest go over the top or under the bottom, so two never
     fall within the 8 units at which drawio_check reads them as one line.
3. **Some boxes arranged:** each unplaced element, in document order, takes the first free slot.
   - Slots are scanned around the arranged elements it relates to: next rank in the orientation
     first, then the same rank, then outward on the grid.
   - A slot is free if the box and its margin overlap nothing.
   - If none is free within a bound, the boxes beyond the insertion rank shift by one rank gap.
     Those moves are reported by the check.
4. **Containers** are sized around their members plus padding. They are never arranged directly.
5. **Cleanup.** The wire rules run on the cells, and their advice is applied with the follower,
   up to a fixed number of rounds. Only wires without an arrangement entry are touched: a person's
   choice is reported if it is defective, never overridden. What remains goes to the check.
6. **Removed elements** drop out of the cells. Their entries stay in the file until the reader or
   agent writes the arrangement again, and the check names them meanwhile.

Determinism: document order everywhere, no randomness, and the follower is already deterministic.

The cleanup needed four additions, all found on the vehicle architecture:
- **Ends on the rank-facing sides.** Wires leave and enter by the sides facing along the ranks
  (bottom to top when the layout runs top to bottom). Each side's ends are spread in the order of
  the other ends' positions. A wire alone on both its sides, between sides that overlap, runs
  straight down the middle of the overlap.
- **The automatic layout snapped to the grid.** A recorded arrangement then draws exactly what
  was shown. Fixed ends are fractions of a box, and a box snapped after the fact moves them by a
  few units.
- **Labels on the longest run, and the kind as the label when there is none.** The rules see
  what the figure writes. A label across a vertical run needs only the run to be two text lines
  tall.
- **The follower kept to one cell, and the first message for a key wins.** It had been applying
  one wire's fix to the next wire's waypoints, and letting a detour's advice undo a shared
  point's.

Measured with cleanup:

| Graph | Elements | Relationships | Time |
|---|---|---|---|
| Largest corpus graph | 64 | 64 | 140 ms |
| Generated | 100 | 196 | 257 ms |

The view must therefore not recompute on every pointer move while dragging.

### 5. The check

The check reuses the rules' messages, with the arrangement's keys translated to element labels.
It adds two warnings:

- an entry naming nothing;
- boxes shifted to make room.

It is returned:

- by the figure tool, in its result;
- by the view, as a short list beside the figure, the way drawio_check reports a diagram.

### 6. Touch-up round-trip, without a `.drawio` file on disk

"Arrange in draw.io" serialises the view's cells (decision 1) into a page:

- **Cell ids** are arrangement keys, encoded to valid draw.io ids.
- **Opening:** the page opens in the existing touch-up frame, in memory.
- **Saving** reads the frame's XML back and diffs it against the generated page:
  - vertex geometry gives element places;
  - connector styles, waypoints and label geometry give relationship entries;
  - anything else (text edits, deleted or new cells, style changes beyond the ends) is listed to
    the reader as not kept.
- *Why no file:* a `.drawio` beside the document would be a second, editable copy of the layout
  that drifts. The arrangement is the only copy.

### 7. Who writes the arrangement

- **The view** writes it when a reader keeps a move or saves a touch-up. The write goes through the
  workspace file API, so a read-only workspace says it cannot keep the move.
- **The figure tool** writes it when it computed places for unnamed elements and the arrangement's
  path is in the writable zone (`assertWritableDestination`). This is how an element placed once
  stays put at the next change (`ANewElementIsRecordedForNextTime`).
- Nothing else writes it.
- *Alternative:* never record automatically. Rejected: two successive additions would each move the
  first, which is the instability this change exists to remove.

### What the monkey test found (task 7.2)
Driven destructively in the running app (`scripts/probes/structured-arrangement/serve.mts`):
- **Done pressed during a keep** asked "leave without keeping?" while the keep was landing. Done
  now waits for the keep, then leaves.
- **The viewpoint switched under a touch-up** kept a whole-document touch-up under the new
  viewpoint. A touch-up now keeps the view it was opened on, and the viewpoint and orientation
  controls are disabled while arranging.
- **The document changed on disk mid touch-up** left the old page open, with gone elements
  movable and new ones missing. With nothing pending the touch-up now opens again on what the
  document holds. With touch-ups pending it says so, and a keep takes only the places of what
  the document still holds.
- **A reread of the arrangement file** after a keep wiped the note about what was not kept
  (task 7.1). A good read now clears only its own "not used" note.
- **A double keep** held: one keep in flight at a time.

## Risks / Trade-offs

- **[The routing port refuses some styles]** → the generated cells use only what the port follows
  exactly: rectangles, orthogonal style, plain ends. A test asserts that every generated connector
  is routed.
- **[Large graphs: cleanup rounds × rules × wires]** → rounds are bounded and only unarranged wires
  are cleaned. Timings are measured on the largest corpus document before the change lands.
- **[A reference shared by an element and a relationship]** → keys are qualified by collection,
  since they live in separate maps (`TwoIdentitiesPerElement`).
- **[Envelope ids reused for another element across versions]** → an id-keyed entry goes to the
  new holder of the id. This is accepted, and references are recommended for elements that last.
  The check shows the place, and the reader moves it.
- **[Curved wires were part of the look]** → orthogonal is draw.io's own default and what the
  user asked for. No option to keep curves.
- **[Word and PowerPoint rendering]** → the SVG is rasterised as today. It is judged in Word and
  PowerPoint desktop, which may differ from the browser (`paint-order` is ignored there).

## Migration Plan

- Graphs without an arrangement file draw with orthogonal routes and cleanup on the first release.
  Nothing on disk changes until someone keeps a move or the agent writes a figure.
- Nudges in component state are replaced by the arrangement. There is nothing persisted to migrate.
- Rollback: the arrangement files are ignored by an older version, and the document is untouched.
