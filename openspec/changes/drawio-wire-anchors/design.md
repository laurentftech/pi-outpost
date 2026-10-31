# Design

## Context

- `checkWires` in `server/src/drawio.ts` walks each wire `routeWire` can route
  (`server/src/drawioRoutes.ts`, a port of the vendored viewer's routing). It warns about boxes
  the wire crosses, its own ends when it crosses them, and labels that sit on boxes. `facingSide()`
  already gives the side of one box that faces another.
- `e2e/drawio-routes.spec.ts` holds the port's routes to the vendored viewer's within half a unit,
  over the live-run fixtures, the jgraph examples and a generated corpus covering every relative
  position, fixed side (corners included) and supported style.
- A wire's label is either its own value or the value of child label cells; `checkWires` already
  gathers both for the label-on-box warning.

## Goals / Non-Goals

**Goals:**
- Three deterministic rules computed from routes alone. The same function then serves the check
  and the e2e comparison against the viewer's routes.
- Each warning carries a fix the agent can apply as-is: concrete `exitX/exitY` or `entryX/entryY`
  values, or a waypoint.

**Non-Goals:**
- Buses, ports, and wires the port does not route.
- Choosing good points for the agent. The check proposes; it does not rewrite the file.
- Ranking or scoring a whole diagram's wiring.

## Decisions

### Rules on routes, as one pure function
`wireAnchorIssues(wires, terminals)`, in a module beside `drawioRoutes.ts`, takes each wire's id,
label, source and target ids, its fixed exit and entry (if any) and its route points, plus the
terminal boxes. It returns the issues. `checkWires` feeds it the port's routes. The e2e test feeds
it the viewer's routes for the same diagrams and compares the two results
(AnchorWarningsMatchTheViewer).
- *Alternative:* evaluate inside `checkWires` as the other rules are. Then the viewer comparison
  would have to reimplement the rules in the test, and two copies drift.

### Shared point
- Each routed wire contributes two ends: (shape, first point) and (shape, last point). Ends on the
  same shape within one unit of each other form a group. The comparison uses the drawn point,
  so wires without fixed points that draw.io lands at the same place are caught too.
- A group warns unless every wire in it has the same non-empty label. Labels are compared after
  stripping markup, collapsing whitespace and folding case. A wire with no label is different
  from every other wire.
- The fix names the side the point is on and proposes free positions on that side among 0.25,
  0.5 and 0.75: the ones no other end of that shape already uses, one per extra wire. When the
  side is full, it says to use another side.
- One warning per group, naming every wire in it and the shape.

### One placement for the ends that must move
An end that runs through its own shape, or that is fixed facing away, has to move to the side
facing the wire's other end. Those ends get their new points from a single pass over the page
(`placeMovingEnds`). Each one gets a point of its own on the facing side (0.5 for a single end,
0.25 and 0.75 for two, then 0.25/0.5/0.75), avoiding points that ends staying put already hold.
The own-ends message in `drawio.ts` and the facing-away message both give these values. The
shared-point rule only groups the ends that stay, and counts the points just handed out as taken.
- *Why:* the second live Codestral run showed the messages contradicting one another. Two
  flows through their own ends were both told to move to the middle of the facing side, which
  would share a point again. The shared-point message proposed spreading them along the side
  they were told to leave.

### End facing away
- This only applies to a fixed point on a side, not a corner: one coordinate is 0 or 1 and the
  other lies strictly between. Corners are ambiguous about their side, so they are left alone.
- "Faces away" means the other end's box lies wholly beyond the opposite edge. For `exitX=1`
  (right side), the other box's right edge is at or left of this box's left edge. A perpendicular
  side is not "away"; when it makes a real detour, the detour rule reports it.
- This rule is skipped when the existing own-ends warning already fired for the wire, so a wire
  gets one message about its ends, not two.

### Detour
- `d` is the distance between the middles of the two facing sides (`facingSide` of each box
  toward the other). The rule warns when `route.length > 2·d` and `route.length − d ≥ 80`.
- The 80-unit floor keeps close neighbours quiet: two boxes 20 apart can have a route twice
  that length that nobody would call a detour.
- Wires with waypoints are included. A waypoint loop is exactly the detour the user described,
  and the fix (another waypoint, or none) is in the message.
- Wires whose ends overlap are skipped: they have no facing sides.
- The thresholds are set in task 1, on the live-run fixtures, before the rule is committed. If
  2× and 80 flag a wire there that a reader would call fine, the numbers change in the spec too.

### A check waits for the writes to its file
The runtime prepares every tool call of a message in order (`tool_execution_start`, then the
`tool_call` hooks), then runs them together, and always ends each one with `tool_execution_end`.
A hook on those two events registers each `write`/`edit` by absolute path (`pendingWrites.ts`).
`drawio_check` waits for the writes to its file before reading it, at most 30 s. The hooks load
with the embedded runtime's extension factories, beside the poster picture hooks, and through
`piOutpostTools.ts` in an RPC child.
- *Why:* in a live Codestral run, an edit and a check sent together reported "no defect" while
  the edit made two new crossings.

### The advice converges when followed
A model that applies the values exactly must not come back to a warning the values were meant to
clear. Three loops of that kind were found by following the advice mechanically
(`server/test/drawioFollowAdvice.ts`) on the diagrams Codestral wrote:
- A wire with no fixed end, whose waypoints took it through its own shapes, was given exit and
  entry values that changed nothing. The message now names the waypoints and says to remove them.
  Such a wire's ends are not "moving" for the placement.
- A side holding three points sent the next wire to another side. A straight wire then crossed
  its own shape, was sent back, and shared a point again. A side now offers seven positions
  (quarters, then eighths) before any wire is sent elsewhere. When it is sent elsewhere, the
  message gives values on the side facing its other end.
- Two groups on the same side of a shape were both offered the same free point. Positions handed
  out are now taken for the groups that follow.
The write registry also compares canonical paths: the write and the check could name one file
through /var and /private/var.

### Needless bends, and a fix that is tried first
On a wire with waypoints, a segment under ten units or one going back over the last is a
needless bend. The orthogonal router makes no such segment of its own; a waypoint a few units off
does. The fix is tried on the route (`routeWire` with the changed waypoints) before it is given,
in this order:
- move the waypoint at, or level with, an end of the segment;
- remove the waypoint at the turn;
- put a fixed end level with the other;
- remove the waypoints;
- line up the shapes.
Removing every waypoint would lose the detours they make around shapes, and the next report would
ask for them back.

### Removing bends by hand
Choosing the style a wire already has changes nothing, so touch-up gets a "remove bends" button,
for the selected wires or the page, as one undoable change. One bend goes with a click on its
handle, then Delete, as a shape does. An orthogonal wire's handles sit in the middle of its
segments, not on its waypoints, so Delete removes the waypoint under the handle, or the waypoints
at the segment's corners. After a bend goes, Delete waits for the next click; otherwise a second
press would delete the wire still selected. draw.io's own gestures, such as a double click on a
bend, stay as they are.

### Labels and wires against each other
Luna's "services" diagram passed every rule above and was still hard to read: a label on
another label, a label across another wire, and wires of different data sharing a line. A label
is boxed from its text at the position draw.io gives it; it is warned when it meets another
label or crosses another wire, with a place along or beside its own wire (`x`, then `y`) that
clears both. Two wires of different data along one line for over 12 units (8 units apart at most)
are warned; the same non-empty label may share a line, as it may share a point. The fix for a
wire is tried on the route in order — shift one waypoint, shift all, add waypoints at the corners
shifted, add one waypoint, move an end — and kept only if it crosses no shape, makes no needless
bend and stays clear of every other-data wire, including the routes other fixes of the same pass
propose. A wire still warned about its ends or points is skipped until those are fixed.
- *Why:* without the pass-wide routes, two fixes landed on the same new line and the advice
  looped; without the order, a label was placed on a wire about to move.

### The report lists fixes in order
Each warning gets a fixing step: shapes, ends, shared points, detours, crossings, labels.
`checkPage` sorts its page's issues by step, errors first, and keeps their order within a step.
The report says to fix them in that order. When a warning concerns a connector, it also says to
put its `id="…"` in the text an edit replaces.
- *Why:* in the live runs, a model kept moving a label while the wire under it stayed wrong. In
  others, edits whose text matched several connectors were refused over and over.

### The skill
`skills/drawio/SKILL.md` Layout gets two bullets: one point per data flow, and leave a box on
the side facing where the wire goes. Weak models read SKILL.md but not its references, so the
rule goes on the page itself.

## Risks / Trade-offs

- [The viewer and the port differ by under half a unit, and a point sits right at the one-unit
  tolerance] → groups are formed on points rounded to the unit, and the e2e comparison shows
  whether any corpus case disagrees.
- [A diagram with a deliberate shared point for different data (a bus drawn by hand) is warned]
  → buses are out of scope by decision; the warning names what to change, and the agent can
  explain if the user wants it kept.
- [More warnings mean more rounds of rewriting for the agent] → each warning carries concrete
  values, and the live-run fixtures show how many a real diagram gets before the rules ship.
