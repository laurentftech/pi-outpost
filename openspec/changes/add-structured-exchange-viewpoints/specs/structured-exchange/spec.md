## MODIFIED Requirements

### Requirement: ReaderMayAdjustAndNarrowTheView

A reader MAY adjust a rendering for legibility — repositioning what it draws, moving around it,
turning it between landscape and portrait where it has an orientation to choose, selecting a viewpoint
the document declares, and narrowing it to selected kinds. For a table, the same narrowing SHALL be offered over the roles its rows declare.
Every kind and every role SHALL be shown by default, and the control SHALL be the key
itself, so what a reader reads a colour from is what they switch.

An adjustment SHALL be presentation only: it SHALL NOT alter the document, and SHALL NOT be carried
back to any authority.

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

### Requirement: TheAgentCanWriteAFigureToAPath

The system SHALL offer the agent a way to write a figure for a validated document to a path, so that
the agent can reference that figure from a document it is writing.

The request SHALL carry the document, the narrowing to apply, and the path to write. It MAY name a
viewpoint the document declares, in which case the figure is narrowed to that viewpoint and any
hidden kinds the request also names apply on top of it. The narrowing
SHALL be expressed in the same terms a reader narrows by — hidden kinds, with element and
relationship vocabularies independent of each other — and an empty narrowing SHALL mean the whole
document, as it does for a reader.

Writing SHALL be confined exactly as every other agent write is confined: a path outside the
writable zone SHALL be refused, and refusal SHALL name the confinement rather than the underlying
filesystem error.

The result SHALL tell the agent what was written, which viewpoint it shows when one was named, and how
much of the document it shows, so that a
narrowing which selected nothing is visible as such rather than delivered as an empty picture.

#### Scenario: AFigureIsWrittenWhereTheAgentAsked
- **WHEN** the agent requests a figure for a validated document at a path inside the writable zone
- **THEN** the file is written at that path and contains that figure

#### Scenario: TheNarrowingIsTheReadersNarrowing
- **GIVEN** an element kind and a relationship kind that share a name
- **WHEN** the agent hides one of them
- **THEN** only the one named is hidden, exactly as it would be for a reader

#### Scenario: NoNarrowingMeansTheWholeDocument
- **WHEN** the agent requests a figure and names no hidden kind
- **THEN** every element and relationship of the document is drawn

#### Scenario: WritingOutsideTheWritableZoneIsRefused
- **WHEN** the agent requests a figure at a path outside the writable zone
- **THEN** the request is refused, the refusal names the confinement, and nothing is written

#### Scenario: TheResultSaysHowMuchItShows
- **WHEN** a figure is written from a narrowed document
- **THEN** the result states how much of the document the figure shows

#### Scenario: ANarrowingThatHidesEverythingIsReportedNotDrawn
- **WHEN** a narrowing leaves no element to draw
- **THEN** the result says so rather than reporting an empty figure as a success

#### Scenario: ARequestMayNameADeclaredViewpoint
- **GIVEN** a document that declares a viewpoint
- **WHEN** the agent requests a figure naming that viewpoint
- **THEN** the figure shows that viewpoint, and the result names it
