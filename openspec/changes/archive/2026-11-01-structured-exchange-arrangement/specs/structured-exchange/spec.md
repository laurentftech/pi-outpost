# Spec Delta

## MODIFIED Requirements

### Requirement: ReaderMayAdjustAndNarrowTheView

A reader MAY adjust a rendering for legibility — repositioning what it draws, moving around it,
turning it between landscape and portrait where it has an orientation to choose, selecting a viewpoint
the document declares, and narrowing it to selected kinds. For a table, the same narrowing SHALL be offered over the roles its rows declare.
Every kind and every role SHALL be shown by default, and the control SHALL be the key
itself, so what a reader reads a colour from is what they switch.

An adjustment SHALL be presentation only: it SHALL NOT alter the document, and SHALL NOT be carried
back to any authority. A repositioning MAY be kept in the graph's arrangement, which is presentation
too (`structured-exchange-arrangement`); turning and narrowing SHALL NOT be kept there.

While a rendering is narrowed, it SHALL state that it is showing less than the whole document, and
that statement SHALL be part of what an export carries — for a table, of its textual equivalent. For a proposal, the statement SHALL make
clear that what is hidden remains part of the proposal, and a hidden kind SHALL NOT be marked in a
way the same rendering uses for a removal.

#### Scenario: EverythingIsShownUntilTheReaderNarrowsIt
- **WHEN** a rendering that distinguishes kinds is first displayed
- **THEN** every element and relationship of the document is shown

#### Scenario: NarrowingIsReversibleAndDeclared
- **WHEN** a reader hides a kind
- **THEN** the rendering says what it is no longer showing, and offers to show everything again

#### Scenario: ANarrowedProposalStillSaysWhatItProposes
- **WHEN** a narrowed rendering of a proposal is exported
- **THEN** the exported figure states how much of the document it shows and that hidden kinds remain part of the proposal

#### Scenario: ElementAndRelationshipVocabulariesAreIndependent
- **WHEN** an element kind and a relationship kind share the same name and the reader hides one of them
- **THEN** only the one they hid is hidden

#### Scenario: AdjustmentDoesNotAlterTheDocument
- **WHEN** a reader repositions, turns, narrows or selects a viewpoint of a rendering
- **THEN** the document recovered for handover is unchanged

#### Scenario: ATableNarrowsByRole
- **WHEN** a reader hides a role in a table that declares roles
- **THEN** only the rows declaring that role stop being shown, the rendering says what it is no longer showing, and it offers to show everything again

#### Scenario: AHiddenRoleIsNotARemovedRow
- **WHEN** a reader hides a role in a table that also declares removed rows
- **THEN** the hidden rows are absent rather than struck through, and the removed rows keep their own marking

#### Scenario: AKeptRepositioningIsNotADocumentChange
- **WHEN** a reader moves a box in a graph and the move is kept in its arrangement
- **THEN** the document recovered for handover is unchanged, and reopening the graph shows the box where the reader left it

### Requirement: AFigureCanBeProducedWithoutABrowser

The system SHALL be able to produce a figure from a validated document, a narrowing and, for a graph,
its arrangement, without a browser, a display, or a running interface.

A figure so produced SHALL be the same figure the interactive rendering exports for the same
document, the same narrowing and the same arrangement. "The same" means the same elements, relationships, messages,
containers, directions, order, labels, colours and geometry; it does not require the two byte
streams to be identical.

Production SHALL be deterministic: the same document, the same narrowing and the same arrangement
SHALL yield the same figure every time.

A document that fails validation SHALL NOT yield a figure. The failure SHALL be reported with the
reason, as validation failures are reported elsewhere, and SHALL NOT produce an empty or partial
figure.

#### Scenario: TheSamePictureWithoutADisplay
- **GIVEN** a validated document and a narrowing
- **WHEN** a figure is produced with no browser present
- **THEN** it carries the same elements, relationships, order, labels and colours as the figure the interactive rendering exports for that document and that narrowing

#### Scenario: ProducingAFigureIsDeterministic
- **WHEN** a figure is produced twice from the same document and the same narrowing
- **THEN** both figures draw the same picture

#### Scenario: AnInvalidDocumentYieldsNoFigure
- **WHEN** a figure is requested for a document that fails validation
- **THEN** the request fails, names the reason, and writes nothing

#### Scenario: TheSameArrangedPictureWithoutADisplay
- **GIVEN** a validated graph with an arrangement
- **WHEN** a figure is produced with no browser present
- **THEN** it has the same places and routes as the figure the interactive rendering exports with that arrangement
