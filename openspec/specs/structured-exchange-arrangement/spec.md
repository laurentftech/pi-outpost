# structured-exchange-arrangement Specification

## Purpose

Keeps the layout of a structured-exchange graph clean and stable: wires routed and cleaned up the way
draw.io diagrams are, and an arrangement versioned beside the document that survives changes to the
model, so a figure revised for the chief engineer is not laid out again by hand.

## Requirements

### Requirement: AnArrangementIsKeptBesideTheDocument

A graph's arrangement SHALL be a file beside its document, holding one arrangement per viewpoint and
one for the whole document. It SHALL declare its own format, so it is never read as a document. It
SHALL be partial: what it does not name is computed. It SHALL be presentation only: it SHALL NOT
alter the document and SHALL NOT be carried back to any authority. The same arrangement SHALL always
be written as the same text.

#### Scenario: AMovedBoxIsKeptInTheArrangement
- **GIVEN** a graph shown with no arrangement file
- **WHEN** the reader moves a box and the move is kept
- **THEN** an arrangement file is written beside the document naming that box's place for the viewpoint shown, and the document is byte for byte unchanged

#### Scenario: AnArrangementIsNeverReadAsADocument
- **WHEN** an arrangement file is opened in the file viewer or given to the figure tool as a document
- **THEN** it is not shown or validated as a structured-exchange document

#### Scenario: AnArrangementWritesTheSameTextTwice
- **WHEN** the same arrangement is written twice, and then written again with one box moved
- **THEN** the first two files are identical, and the third differs only in that box's entry

### Requirement: ArrangementEntriesFollowIdentity

An entry SHALL name an element or relationship by the reference it carries, qualified by what it
names, and otherwise by its envelope identifier. An entry naming nothing the document still holds
SHALL NOT be drawn, and SHALL be reported by the arrangement check.

#### Scenario: AnElementKeepsItsPlaceThroughItsReference
- **GIVEN** an arranged element that carries a reference
- **WHEN** a new version of the document gives it another envelope identifier with the same reference
- **THEN** it is drawn at its arranged place

#### Scenario: AnEntryForSomethingGoneIsNamed
- **GIVEN** an arrangement naming an element the document no longer holds
- **WHEN** the graph is drawn and checked
- **THEN** nothing is drawn for that entry, and the check names it as naming nothing

### Requirement: RelationshipsAreRoutedOrthogonally

A graph's relationships SHALL be drawn in horizontal and vertical segments, routed as draw.io routes
an orthogonal connector between the same boxes, sides and waypoints. The interactive rendering and
the browserless figure SHALL draw the same routes. A relationship from an element to itself SHALL
still be drawn with extent.

#### Scenario: WiresRunInStraightSegments
- **WHEN** a graph is drawn
- **THEN** every relationship between two distinct elements is a path of horizontal and vertical segments

#### Scenario: TheRoutesAreDrawioRoutes
- **GIVEN** a graph's boxes, sides and waypoints written as a draw.io diagram
- **WHEN** the vendored draw.io viewer draws that diagram
- **THEN** each connector follows the route the graph draws for its relationship

### Requirement: TheAutomaticPlacementIsCleanedUp

A place the arrangement does not give SHALL be computed, then cleaned up by drawio_check's wire rules
until none applies or nothing more can be done. The rules are: no shared point between different
data, ends on facing sides, no detour, no needless bend, no label on a label or across a wire, no two
wires of different data on one line. Placement SHALL be deterministic.

#### Scenario: AFreshFigureHasNoWireDefectLeftUnreported
- **GIVEN** a graph with no arrangement, from the corpus of real documents
- **WHEN** it is drawn
- **THEN** every defect those rules find in the drawing is one the arrangement check lists

#### Scenario: TwoFlowsToOneBoxLeaveFromTheirOwnPoints
- **GIVEN** two relationships with different labels from one element to elements on the same side of it
- **WHEN** the graph is drawn with no arrangement
- **THEN** they leave the element at two different points of the side facing their targets

### Requirement: AChangeKeepsWhatIsArranged

When the document changes, every element the arrangement places SHALL stay at its place, and every
relationship whose ends kept their places SHALL keep its route. A new element SHALL be placed near
what it relates to, moving others only when there is no room, and those moves SHALL be reported. A
removed element SHALL leave its place empty. Only wires a change touches SHALL be routed again.

#### Scenario: AnAddedElementLeavesTheRestInPlace
- **GIVEN** an arranged graph
- **WHEN** a new version adds one element related to an existing one
- **THEN** every previously arranged box is at the same place, the new element is beside the one it relates to, and only the wires touching it, or crossing its box, have new routes

#### Scenario: ARemovedElementLeavesItsPlaceEmpty
- **GIVEN** an arranged graph
- **WHEN** a new version removes one element
- **THEN** every other box is at the same place and no other box moves into the gap

#### Scenario: AChangedLabelKeepsTheRoute
- **GIVEN** an arranged graph
- **WHEN** a new version changes only a relationship's label
- **THEN** that relationship's route is unchanged

### Requirement: TheArrangementIsCheckedAgainstTheDocument

The arrangement check SHALL list, for the viewpoint drawn, what is left for a person to look at: the
wire rules' warnings the cleanup could not resolve, a wire through a box, an entry naming nothing,
and boxes moved to make room. Each SHALL name the elements and relationships concerned and, where
one exists, the value that fixes it. A clean arrangement SHALL report nothing.

#### Scenario: AWireThroughABoxIsListed
- **GIVEN** an arrangement whose waypoints take a relationship through a box
- **WHEN** it is checked
- **THEN** the check names the relationship and the box, with a waypoint or side that avoids it

#### Scenario: ACleanArrangementReportsNothing
- **WHEN** an arrangement with no defect is checked
- **THEN** the check reports nothing

### Requirement: AFigureCanBeArrangedInDrawioTouchUp

The reader SHALL be able to open a graph's viewpoint as a draw.io diagram and arrange it with the
touch-up: move boxes, move wire ends, remove bends, move labels. Saving SHALL write the places,
sides, waypoints and label places into the arrangement, by identity. An edit that is not arrangement
SHALL NOT change the document, and the reader SHALL be told it was not kept.

#### Scenario: ATouchUpIsReadBackByIdentity
- **GIVEN** a graph opened in touch-up
- **WHEN** the reader moves a box, moves a wire's end to another side and removes a bend, then saves
- **THEN** the graph is drawn with that box, that side and without that bend, and the arrangement names them by identity

#### Scenario: AContentEditInDrawioIsNotAModelChange
- **GIVEN** a graph opened in touch-up
- **WHEN** the reader edits a box's text, deletes a wire and saves
- **THEN** the document is unchanged, the arrangement keeps the places, and the reader is told the text and the deleted wire were not kept

### Requirement: TheAgentIsToldWhatTheArrangementLeaves

When the agent writes a figure, it SHALL be drawn with the arrangement for its viewpoint. The places
computed for what the arrangement did not name SHALL be recorded in it when the arrangement's
location is writable. The result SHALL say whether an arrangement was used, what was recorded, and
what the arrangement check lists.

#### Scenario: AFigureIsWrittenWithItsArrangement
- **GIVEN** a document with an arrangement for a viewpoint
- **WHEN** the agent writes a figure for that viewpoint
- **THEN** the figure draws the arranged places, and the result says the arrangement was used

#### Scenario: ANewElementIsRecordedForNextTime
- **GIVEN** an arranged document to which a new version adds an element
- **WHEN** the agent writes a figure, then a later version adds another element
- **THEN** the first new element is at the same place in both figures

#### Scenario: WhatIsLeftIsInTheResult
- **GIVEN** an arrangement the check lists something for
- **WHEN** the agent writes a figure
- **THEN** the result carries what the check lists
