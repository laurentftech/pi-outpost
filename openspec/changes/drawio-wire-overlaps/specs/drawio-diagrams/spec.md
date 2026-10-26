## ADDED Requirements

### Requirement: DrawioCheckSeesWires

`drawio_check` SHALL compute each wire's route as the draw.io viewer pi-outpost ships does, for
straight wires, waypoints, `orthogonalEdgeStyle`, `segmentEdgeStyle` and `elbowEdgeStyle`, and
SHALL warn, naming the wire and the shape and saying what to change, when a wire runs through a
labelled shape other than its ends, when it runs through its own source or target, and when its
label sits on a labelled shape. A wire it cannot route the viewer's way SHALL be left unchecked.

#### Scenario: AWireThroughAnotherBoxIsWarned
- **GIVEN** three labelled boxes in a row and a wire from the first to the third, straight or orthogonal
- **WHEN** the agent checks the diagram
- **THEN** a warning names the wire and the middle box, and says to move the box, add a waypoint, or route the wire around it

#### Scenario: AWireThroughItsOwnEndIsWarned
- **GIVEN** a wire leaving the top of its source and entering the bottom of its target, the source above the target
- **WHEN** the agent checks the diagram
- **THEN** a warning names the wire and both of its ends, and says to fix the exit and entry on the sides facing each other

#### Scenario: ALabelOnABoxIsWarned
- **GIVEN** a labelled wire whose label falls on a labelled box
- **WHEN** the agent checks the diagram
- **THEN** a warning names the wire's label and the box, and says to move the label or the box

#### Scenario: RoutesMatchTheViewer
- **GIVEN** a corpus of diagrams: the live runs', the repository's, and generated ones covering every relative position, fixed side and supported style
- **WHEN** the routes are computed by the check and by the vendored viewer
- **THEN** every wire the check routes has the viewer's points within half a unit

#### Scenario: AClearDiagramStaysClean
- **GIVEN** a diagram whose wires go around the boxes and whose labels sit clear of them
- **WHEN** the agent checks it
- **THEN** no wire or label warning is reported

#### Scenario: AnUnroutedWireIsLeftAlone
- **GIVEN** a wire with a style the check does not route, or a rotated end
- **WHEN** the agent checks the diagram
- **THEN** no warning is reported for that wire

### Requirement: DrawioTouchUpWireStyle

In touch-up, the person SHALL be able to choose how wires are drawn — straight, orthogonal or
curved — for the selected wires, or for every wire of the page shown when none is selected, as
one undoable change that removes their waypoints. New wires SHALL take the chosen style. Touch-up
SHALL start with the style most of the page's wires have.

#### Scenario: EveryWireIsRestyled
- **GIVEN** a page whose wires are straight diagonals, in touch-up, nothing selected
- **WHEN** the person chooses orthogonal
- **THEN** every wire of the page is orthogonal, one undo makes them straight again, and saving writes the style into the file

#### Scenario: OnlyTheSelectedWiresAreRestyled
- **GIVEN** a page with several wires, one of them selected
- **WHEN** the person chooses curved
- **THEN** only that wire is curved

#### Scenario: NewWiresFollowThePage
- **GIVEN** a page whose wires are mostly straight
- **WHEN** the person starts touch-up and draws a new wire from one box to another
- **THEN** the new wire is straight
