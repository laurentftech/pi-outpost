# Design

## 1. Port, do not approximate
Models mostly write `edgeStyle=orthogonalEdgeStyle` with no waypoints. Its route comes from
`mxEdgeStyle.OrthConnector`: a pattern table chosen by the quadrant of the target, the preferred
sides, jetty sizes and port constraints. A home-made elbow guess would put bends where draw.io
does not, warning about crossings that are not drawn and missing ones that are. The port follows
the source of the draw.io release we vendor (v32.5.5, `src/main/webapp/mxgraph/src`), including
draw.io's overrides in `js/grapheditor/Graph.js` (`centerPerimeter`, the elbow connectors).

## 2. What the port covers
Model coordinates at scale 1, translate 0. Vertices: absolute bounds through their parent
containers. Ends: fixed (`exitX/exitY/exitDx/exitDy/exitPerimeter`, `entry…`), projected on the
perimeter, or floating (the perimeter point toward the next route point, orthogonal for
orthogonal styles). Styles: none (straight, waypoints as given), `orthogonalEdgeStyle` (falling
back to `SegmentConnector` with waypoints or when too short, as draw.io does),
`segmentEdgeStyle`, `elbowEdgeStyle` with `elbow=vertical|horizontal`. Perimeters: rectangle
(default), ellipse, rhombus, `centerPerimeter`. Anything else — rotated or flipped ends, ports
(`sourcePort`), `snapToPoint`, other edge styles, loops, stencil aspect — marks the wire as
unrouted, and it is not checked.

## 3. The oracle
`scripts/probes/drawio-routes-oracle.mts` loads the vendored viewer in headless Chromium,
decodes each page into a `Graph` and reads `state.absolutePoints` and the label's bounding box.
A test runs it over a corpus — the diagrams of the live runs, the repository's fixtures, and
generated diagrams covering every pair of relative positions, fixed sides and styles — and
requires the port's routes to match within half a unit for every wire the port claims to route.
That test is what lets the warnings be trusted.

## 4. Crossings
A wire crosses a shape when one of its segments passes through the shape's inside, shrunk by
2 units so that a wire along an edge or ending on the outline does not count. Inside means the
shape's own outline for ellipses and rhombuses, its box otherwise. Only labelled boxes are
obstacles, as for overlaps: lines, images, groups, free text and containers of either end are
not. For its own ends, the part of the route between the end point on the outline and the next
point is tested: entering the shape there is the defect.

## 5. Labels
The label's centre is where draw.io puts it (`getPoint`: along the route by the geometry's x,
across by its y, plus its offset). Its size is estimated from the text and `fontSize`, since the
server measures no text; the estimate is calibrated on the oracle's measured boxes and errs
small, so that a warning means the label really sits on the shape. Warned when the label box
covers a labelled shape by more than a sliver.

## 6. Wire style in touch-up
Three styles, as draw.io's own Waypoints menu names them: straight (`edgeStyle=none`), orthogonal
(`edgeStyle=orthogonalEdgeStyle`), curved (`edgeStyle=orthogonalEdgeStyle;curved=1`). Applying
one sets those keys on the wires and removes their waypoints (draw.io resets them too: waypoints
laid out for one style make no sense in another), in one model update, so one undo takes it
back. With wires selected it applies to them; with none, to every wire of the page shown. The
graph's `currentEdgeStyle`, which new wires take, is set to the same style. When touch-up starts,
it is set to the style most of the page's wires have, orthogonal for a page without wires. The
frame reports the style of the selected wires (or "mixed") with each change, so the control
shows what it would change.
