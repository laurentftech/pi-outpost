## MODIFIED Requirements

### Requirement: ReaderMayAdjustAndNarrowTheView

A reader MAY adjust a rendering for legibility — repositioning what it draws, moving around it,
turning it between landscape and portrait where it has an orientation to choose, and narrowing it to
selected kinds. For a table, the same narrowing SHALL be offered over the roles its rows declare.
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
- **WHEN** a reader repositions, turns or narrows a rendering
- **THEN** the document recovered for handover is unchanged

#### Scenario: ATableNarrowsByRole
- **WHEN** a reader hides a role in a table that declares roles
- **THEN** only the rows declaring that role stop being shown, the rendering says what it is no longer showing, and it offers to show everything again

#### Scenario: AHiddenRoleIsNotARemovedRow
- **WHEN** a reader hides a role in a table that also declares removed rows
- **THEN** the hidden rows are absent rather than struck through, and the removed rows keep their own marking
