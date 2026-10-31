# Spec Delta

## ADDED Requirements

### Requirement: DrawioCheckSeesSharedWirePoints

For the wires it routes as the viewer does, `drawio_check` SHALL warn when two or more wires meet
a shape at the same drawn point, within one unit, leaving it or entering it, unless they all carry
the same non-empty label: their own text or that of their attached label cells. The warning SHALL
name the wires and the shape and propose other points on the same side.

#### Scenario: SharedPointWithDifferentLabelsIsWarned
- **GIVEN** two wires labelled "orders" and "invoices" leaving the same box at `exitX=1;exitY=0.5`
- **WHEN** the agent checks the diagram
- **THEN** a warning names both wires and the box, and proposes other points on the right side, such as `exitY=0.25` and `exitY=0.75`

#### Scenario: SharedPointWithTheSameLabelIsAllowed
- **GIVEN** two wires both labelled "orders" leaving the same box at the same point toward two boxes
- **WHEN** the agent checks the diagram
- **THEN** no shared-point warning is reported

#### Scenario: UnlabelledWiresOnOnePointAreWarned
- **GIVEN** two wires without a label entering the same box at the same point
- **WHEN** the agent checks the diagram
- **THEN** a shared-point warning names both wires and the box

#### Scenario: WiresDrawnToTheSamePointWithoutFixedPointsAreWarned
- **GIVEN** two differently labelled wires with no `exitX`/`entryX` that draw.io ends at the same point of a box
- **WHEN** the agent checks the diagram
- **THEN** a shared-point warning names both wires and the box

### Requirement: DrawioCheckSeesEndsFacingAway

For the wires it routes as the viewer does, `drawio_check` SHALL warn when a fixed exit or entry on
a side of its shape, not a corner, faces away from the wire's other end, meaning the other end
lies wholly beyond the opposite side, even when the route crosses no shape. The warning SHALL
give the facing side's values, or say to drop the fixed point.

#### Scenario: AnEndFacingAwayIsWarned
- **GIVEN** a box left of another, and a wire from it fixed at `exitX=0;exitY=0.5` (its left side), whose route goes around the box without crossing it
- **WHEN** the agent checks the diagram
- **THEN** a warning names the wire and the box, and gives `exitX=1;exitY=0.5`

### Requirement: DrawioCheckSeesWireDetours

For the wires it routes as the viewer does, between two shapes that do not overlap,
`drawio_check` SHALL warn when the route is more than twice the distance between the middles of
the two shapes' facing sides and at least 80 units longer, saying to use the facing sides or a
waypoint. A wire the check does not route SHALL get none of the anchor warnings, and the anchor
warnings SHALL be the same on the viewer's routes as on the check's.

#### Scenario: ADetourIsWarned
- **GIVEN** two boxes side by side 80 units apart, and an orthogonal wire whose route runs more than twice that distance and at least 80 units more
- **WHEN** the agent checks the diagram
- **THEN** a warning names the wire and says to use the facing sides or a waypoint

#### Scenario: DirectWiresOnDistinctPointsStayClean
- **GIVEN** a diagram whose wires each leave and enter at their own point, on the sides facing each other
- **WHEN** the agent checks it
- **THEN** no shared-point, facing-away or detour warning is reported

#### Scenario: AnchorWarningsMatchTheViewer
- **GIVEN** the route corpus of RoutesMatchTheViewer
- **WHEN** the three rules are evaluated on the check's routes and on the vendored viewer's routes
- **THEN** both give the same warnings

### Requirement: DrawioCheckWaitsForWritesInFlight

When the agent sends a write or an edit of a file in the same message as `drawio_check` of that
file, the check SHALL report on the file as that write leaves it. A write that never reports its
end SHALL NOT hold the check beyond a bounded wait, and a write to another file SHALL NOT hold it
at all.

#### Scenario: ACheckWaitsForAWriteInFlight
- **GIVEN** a diagram with a wire through its own ends, and one agent message holding an edit that fixes it and `drawio_check` of the same file
- **WHEN** the runtime runs the two calls together
- **THEN** the check reports the edited file, with no defect

### Requirement: DrawioCheckReportOrder

`drawio_check` SHALL list a page's warnings in the order they are best fixed: shapes (overlaps,
empty or overflowing shapes), then where wires meet their shapes (ends, shared points), then
routes (detours, wires through shapes), then labels. With several warnings, the report SHALL say
to fix them in that order, starting with the first. When warnings concern connectors, it SHALL say
to include the connector's id in the text an edit replaces.

#### Scenario: TheReportListsFixesInOrder
- **GIVEN** a page with overlapping shapes, two different flows on one point, a wire through another box and a label on a box
- **WHEN** the agent checks it
- **THEN** the overlap is listed first, then the shared point, then the crossing, then the label, and the report says to fix them in the order listed

### Requirement: DrawioAnchorAdviceConverges

Every warning about where a wire meets its shapes SHALL give something to apply: values for the
wire's exit or entry, or, when its waypoints take it through its own ends, to remove them. Applying
the advice of a report to the letter and checking again SHALL NOT bring back a warning the advice
was meant to clear: points handed out on one shape SHALL be distinct, and a wire SHALL be sent to
another side only once its own side has no free point.

#### Scenario: FollowingTheAdviceConverges
- **GIVEN** the diagrams models wrote in live runs
- **WHEN** every value and every waypoint removal the reports give is applied, and the diagram checked again, until nothing is left to apply
- **THEN** no anchor warning is left, and no state repeats

#### Scenario: WaypointsThroughTheEndsAreNamed
- **GIVEN** a wire with no fixed exit or entry whose waypoints take it back through its source
- **WHEN** the agent checks the diagram
- **THEN** the warning says its waypoints take it across, and to remove them, with no exit or entry values

### Requirement: DrawioCheckSeesNeedlessBends

For a wire with waypoints or a fixed end, `drawio_check` SHALL warn about a segment shorter than
twenty units or one going back over the one before it, and SHALL name a fix it has tried on the
route: the waypoint to move and where, the waypoint to remove, a fixed end to put level with the
other, dropping the fixed ends, removing the waypoints, or the shapes to line up. A wire with free
ends and no waypoint SHALL get no such warning.

#### Scenario: ANeedlessBendIsWarned
- **GIVEN** a wire whose fixed exit is at y 70 and whose first waypoint is at y 76
- **WHEN** the agent checks the diagram
- **THEN** a warning names the wire and the six-unit segment, and says to move that waypoint to y 70; once moved, no needless bend is reported

#### Scenario: AStepBetweenFixedEndsIsWarned
- **GIVEN** a wire with no waypoint whose exit and entry are both fixed at 0.3 of the height, on boxes 60 and 80 high
- **WHEN** the agent checks the diagram
- **THEN** a warning names the six-unit step and gives the entry value that puts it level with the exit; with that value, no needless bend is reported

### Requirement: DrawioTouchUpBends

In touch-up, the person SHALL be able to remove the bends of the selected wires, or of every
wire of the page when none is selected, as one undoable change, and to remove one bend by
clicking its handle and pressing Delete, without deleting the wire. draw.io's own gestures on
wires SHALL keep working.

#### Scenario: TheBendsOfWiresAreRemoved
- **GIVEN** a page whose wires have waypoints, in touch-up, nothing selected
- **WHEN** the person chooses remove bends
- **THEN** no wire has a waypoint, one undo puts them back, and saving writes the wires without them

#### Scenario: ABendIsRemovedByClickAndDelete
- **GIVEN** a selected wire with two waypoints, in touch-up
- **WHEN** the person clicks the handle of a segment that ends at one of them and presses Delete twice
- **THEN** that waypoint is gone, the other stays, and the wire is still there

### Requirement: DrawioCheckSeesWiresAndLabelsTogether

`drawio_check` SHALL warn about a label on another label or across another wire, and about two
wires along one line for over twelve units unless they share a non-empty label. Each warning SHALL
name a fix tried on the routes that crosses no shape, adds no needless bend and stays clear of
the other wires. Wires warned about their ends or points are left until those are fixed.

#### Scenario: LabelsOnLabelsAreWarned
- **GIVEN** two connectors whose labels are drawn on each other
- **WHEN** the agent checks the diagram
- **THEN** a warning names both labels and gives the x (and y) to set on one of them; with those values, its label lies on no other label

#### Scenario: ALabelAcrossAWireIsWarned
- **GIVEN** a connector's label drawn across another connector
- **WHEN** the agent checks the diagram
- **THEN** a warning names the label and the connector it crosses, and gives the x (and y) that move it clear along its own connector

#### Scenario: AWireAlongAnotherIsWarned
- **GIVEN** two connectors with different labels that run down the same line for 71 units
- **WHEN** the agent checks the diagram
- **THEN** a warning names both, the length and where the run starts, and gives the waypoints or end values for one of them; following the advice leaves no two wires on one line

#### Scenario: TheSameDataMayShareALine
- **GIVEN** two connectors with the same label along one line, and a label clear of every wire
- **WHEN** the agent checks the diagram
- **THEN** neither is warned
