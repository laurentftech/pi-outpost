# diagram-orientation Specification

## Purpose

Decides which way a diagram flows — across the page or down it — so that a diagram with many
elements stays legible in a reading column, and gives the reader the last word on that choice
without ever changing what the diagram says.

## Requirements

### Requirement: OrientationIsChosenForLegibility

The system SHALL choose an orientation for every orientable diagram it draws. Landscape SHALL be the
choice unless the landscape layout is too wide for its content to remain legible, in which case
portrait SHALL be chosen.

The choice SHALL be a function of the diagram alone, measured against a fixed reference width
standing for the reading column. It SHALL NOT depend on the size of the window, the device, the
surface the diagram appears in, or anything else outside the diagram — so that the same diagram is
oriented the same way wherever it is drawn, including where it is drawn with no display present.

#### Scenario: AWideDiagramIsTurned
- **WHEN** a graph whose landscape layout is far wider than the reference width is drawn with no reader choice
- **THEN** it is drawn portrait

#### Scenario: ASmallDiagramIsLeftAlone
- **WHEN** a graph whose landscape layout fits the reference width is drawn with no reader choice
- **THEN** it is drawn landscape

#### Scenario: TheChoiceDoesNotDependOnTheWindow
- **GIVEN** the same diagram drawn in a narrow surface and in a wide one
- **WHEN** no reader has chosen an orientation
- **THEN** both are drawn in the same orientation

#### Scenario: TheChoiceIsDeterministic
- **WHEN** the orientation for the same diagram is chosen twice
- **THEN** both choices are the same

### Requirement: TheReaderDecidesLast

A reader MAY switch an orientable diagram between landscape and portrait, and their choice SHALL
override the automatic one for as long as they are looking at that diagram. The control SHALL name
the orientation it would switch to — it states an action, as every other control does — and
switching SHALL be reversible.

The choice SHALL be presentation only: it SHALL NOT alter the document or the source the diagram was
drawn from, SHALL NOT be carried back to any authority, and SHALL NOT be persisted.

#### Scenario: TheReaderTurnsADiagram
- **WHEN** a reader switches an orientable diagram to the other orientation
- **THEN** the diagram is redrawn that way and the control now names the orientation it came from

#### Scenario: TheReaderOverridesTheAutomaticChoice
- **GIVEN** a diagram the system drew portrait because landscape was unreadable
- **WHEN** the reader switches it to landscape
- **THEN** it is drawn landscape

#### Scenario: TurningStartsFromTheComputedLayout
- **GIVEN** a reader who has repositioned boxes in a rendering
- **WHEN** they turn it to the other orientation
- **THEN** it is drawn from the layout computed for that orientation, rather than carrying offsets measured against the other one

#### Scenario: SwitchingDoesNotAlterTheDocument
- **WHEN** a reader switches the orientation of a structured-exchange rendering
- **THEN** the document recovered for handover is unchanged

### Requirement: AnAuthoredDirectionDoesNotOverrideLegibility

When a diagram's source states its own direction, that direction SHALL be honoured while the diagram
drawn in it is legible. When it is not — by the same measure applied to every other diagram — the
system SHALL draw the diagram in the other orientation instead.

A diagram drawn against the direction its source states SHALL say so, and the source offered to the
reader for copying or reading SHALL remain the source as it was authored. The reader SHALL be able to
return the diagram to its authored direction.

#### Scenario: AnUnreadableAuthoredDirectionIsOverridden
- **GIVEN** a diagram whose source states a direction and whose layout in that direction is far wider than the reference width
- **WHEN** it is drawn with no reader choice
- **THEN** it is drawn in the other orientation

#### Scenario: AReadableAuthoredDirectionIsKept
- **GIVEN** a diagram whose source states a direction and whose layout in that direction fits the reference width
- **WHEN** it is drawn with no reader choice
- **THEN** it is drawn in the direction its source states

#### Scenario: AnOverriddenDiagramSaysSo
- **WHEN** a diagram is drawn against the direction its source states
- **THEN** the rendering states that it is not drawn in the direction its source asks for

#### Scenario: TheAuthoredSourceIsWhatTheReaderGets
- **WHEN** a reader copies or reads the source of a diagram the system re-oriented
- **THEN** they get the source as it was authored, with its original direction

### Requirement: OnlyOrientableDiagramsOfferTheChoice

The system SHALL offer orientation only for diagrams that have one to choose: a graph rendering, and
diagram sources whose notation carries a direction. A sequence, a table, and a diagram notation with
no direction of its own SHALL offer no orientation control, and their sources SHALL NOT be rewritten.

#### Scenario: ASequenceOffersNoOrientation
- **WHEN** a sequence rendering is displayed
- **THEN** no orientation control is offered

#### Scenario: ATableOffersNoOrientation
- **WHEN** a table rendering is displayed
- **THEN** no orientation control is offered

#### Scenario: ANotationWithNoDirectionIsLeftAlone
- **WHEN** a diagram is written in a notation that carries no direction
- **THEN** no orientation control is offered and its source is drawn exactly as written

### Requirement: OrientationChangesThePictureAndNothingElse

A diagram SHALL carry the same content in either orientation: the same elements, relationships,
messages, containers, labels, colours, key, and textual equivalent. Only the arrangement SHALL
differ.

A figure exported from a rendering SHALL be in the orientation that rendering is showing, so that
what a reader takes away is what they approved.

#### Scenario: TheSameContentEitherWay
- **GIVEN** a graph drawn landscape
- **WHEN** the same graph is drawn portrait
- **THEN** both carry the same elements, relationships, containers, labels and colours, and the same textual equivalent

#### Scenario: NarrowingSurvivesTheTurn
- **GIVEN** a rendering narrowed to selected kinds
- **WHEN** the reader switches its orientation
- **THEN** it still shows the same kinds and still states that it is showing less than the whole document

#### Scenario: TheExportIsWhatIsShown
- **WHEN** a reader exports a figure from a rendering they have turned
- **THEN** the exported figure is in the orientation they were shown
