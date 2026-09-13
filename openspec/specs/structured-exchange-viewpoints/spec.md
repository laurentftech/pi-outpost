# structured-exchange-viewpoints Specification

## Purpose
Lets a producer name the readings a model is made for — each a viewpoint that frames one concern and
retains the kinds that address it — so that a reader can select one, and the agent can write a figure
for one, without either rebuilding the selection by hand.

## Requirements

### Requirement: ViewpointsBelongToTheEnrichedContract

The version 2 structured-exchange contract SHALL define viewpoints as one optional envelope property,
and SHALL change nothing else it defines. Every document that was valid under version 2 without
viewpoints SHALL remain valid, with the same meaning.

The version 1 contract SHALL NOT acquire viewpoints: a document declaring the version 1 identifier that
carries viewpoints SHALL be refused, and every version 1 document SHALL reach the verdict and the
diagnostics it reached before.

A producer SHALL be able to check a document with viewpoints outside the application with the same schema,
semantic rules and diagnostics the application applies.

#### Scenario: AnEnrichedDocumentWithoutViewpointsIsUnchanged
- **WHEN** a version 2 document that was valid before viewpoints were defined is validated
- **THEN** it is valid, and every construct it carries means what it meant before

#### Scenario: AnEnrichedDocumentMayDeclareViewpoints
- **WHEN** a version 2 graph document declares valid viewpoints
- **THEN** it is valid, and its viewpoints survive validation, presentation and recovery unaltered

#### Scenario: VersionOneDoesNotAcquireViewpoints
- **WHEN** a document declaring the version 1 identifier carries viewpoints
- **THEN** it is refused

#### Scenario: VersionOneIsUntouched
- **WHEN** the frozen version 1 corpus is validated after viewpoints are defined
- **THEN** every case reaches its recorded verdict

#### Scenario: AProducerChecksViewpointsOutsideTheApplication
- **WHEN** a producer checks a document with viewpoints with the standalone check
- **THEN** it reaches the verdict and the diagnostics the application would

### Requirement: AViewpointFramesAConcernAndRetainsItsKinds

A version 2 graph document MAY declare viewpoints. A viewpoint SHALL have an identifier unique among
the document's viewpoints, a label, and the concern it addresses, and SHALL retain element kinds,
relationship kinds, or both.

A viewpoint SHALL be an inclusion: showing it SHALL show the elements whose kind it retains and the
relationships whose kind it retains, and hide the rest. A vocabulary the viewpoint names no kinds for
SHALL be left whole, so a viewpoint retaining only element kinds still shows the relationships among
the elements it shows. Element and relationship vocabularies SHALL stay independent: a name retained in
one SHALL NOT retain the same name in the other.

An element or relationship that declares no kind SHALL NOT be hidden by a viewpoint, as it is not
hidden by any narrowing by kind. A relationship SHALL still be hidden when either of its endpoints is.

Containers SHALL be treated as they are under any narrowing by kind.

#### Scenario: AViewpointRetainsOnlyItsKinds
- **GIVEN** a graph whose elements and relationships have several kinds, and a viewpoint retaining some of them
- **WHEN** that viewpoint is shown
- **THEN** exactly the elements and relationships of the retained kinds are shown

#### Scenario: AVocabularyTheViewpointDoesNotNameIsLeftWhole
- **GIVEN** a viewpoint that retains element kinds and names no relationship kind
- **WHEN** it is shown
- **THEN** every relationship between two shown elements is shown

#### Scenario: VocabulariesStayIndependent
- **GIVEN** an element kind and a relationship kind that share a name, and a viewpoint retaining that name as an element kind only
- **WHEN** the viewpoint is shown
- **THEN** elements of that kind are shown and relationships of that kind are not retained by it

#### Scenario: AKindlessElementIsNotHiddenByAViewpoint
- **WHEN** a viewpoint is shown over a graph containing an element that declares no kind
- **THEN** that element is shown

#### Scenario: AKindAddedLaterIsNotShownUnannounced
- **GIVEN** a viewpoint retaining some kinds of a graph
- **WHEN** the graph gains an element of a kind the viewpoint does not retain
- **THEN** the viewpoint does not show that element

### Requirement: AViewpointThatCannotBeMeantIsRefused

Validation SHALL refuse, naming the rule and pointing at the offending value:

- a viewpoint retaining a kind that no element, or respectively no relationship, of the document has;
- two viewpoints of one document sharing an identifier;
- a viewpoint retaining no kind at all;
- viewpoints on a document that is not a graph.

Viewpoints SHALL be bounded: the number per document, the kinds per viewpoint, and the length of each
identifier, label and concern SHALL each have a published ceiling, enforced before and after parsing
as every other bound of the contract is.

A near-miss kind SHALL be refused, never corrected to the closest kind the document has.

#### Scenario: AViewpointNamingAnAbsentKindIsRefused
- **WHEN** a viewpoint retains an element kind no element of the document has
- **THEN** the document is refused, naming the rule and pointing at that kind

#### Scenario: ANearMissKindIsNotCorrected
- **WHEN** a viewpoint retains a kind that differs from a present kind by one character
- **THEN** the document is refused, and nothing is substituted for the kind

#### Scenario: DuplicateViewpointIdentifiersAreRefused
- **WHEN** two viewpoints of one document share an identifier
- **THEN** the document is refused, pointing at the second

#### Scenario: AViewpointRetainingNothingIsRefused
- **WHEN** a viewpoint names no element kind and no relationship kind
- **THEN** the document is refused

#### Scenario: ViewpointsOutsideAGraphAreRefused
- **WHEN** a sequence or table document declares viewpoints
- **THEN** the document is refused

#### Scenario: ViewpointsAreBounded
- **WHEN** a document exceeds the ceiling on viewpoints, on kinds per viewpoint, or on the length of a viewpoint's text
- **THEN** it is refused, naming the ceiling it exceeds

### Requirement: AReaderCanSelectAViewpoint

A rendering of a document that declares viewpoints SHALL let the reader select one of them, or the whole
document. The whole document SHALL be shown until the reader selects a viewpoint.

Selecting a viewpoint SHALL narrow the rendering to it. The key's type toggles SHALL still apply on top
of the selection. While a viewpoint is selected, the rendering SHALL state which viewpoint it shows and
the concern that viewpoint frames, in addition to the statement any narrowing already makes; and it
SHALL say so when the reader has adjusted the selection further with the key.

The reader SHALL be able to return to the whole document in one action. A rendering of a document that
declares no viewpoints SHALL offer no selection.

Selection SHALL be presentation only: it SHALL NOT alter the document, SHALL NOT be carried back to any
authority, and SHALL NOT be persisted.

#### Scenario: TheWholeDocumentIsShownUntilAViewpointIsSelected
- **WHEN** a document declaring viewpoints is first rendered
- **THEN** every element and relationship is shown, and the selection reads as the whole document

#### Scenario: SelectingAViewpointNarrowsToIt
- **WHEN** the reader selects a viewpoint
- **THEN** the rendering shows what that viewpoint retains and nothing else

#### Scenario: TheRenderingSaysWhichViewpointItShows
- **WHEN** a viewpoint is selected
- **THEN** the rendering states the viewpoint's label and the concern it frames

#### Scenario: TheKeyStillAppliesOnTopOfAViewpoint
- **GIVEN** a selected viewpoint
- **WHEN** the reader hides a further kind from the key
- **THEN** that kind is hidden too, and the rendering says the viewpoint has been adjusted

#### Scenario: ReturningToTheWholeDocument
- **GIVEN** a selected viewpoint
- **WHEN** the reader selects the whole document
- **THEN** every element and relationship is shown again, and no viewpoint is stated

#### Scenario: ADocumentWithoutViewpointsOffersNoSelection
- **WHEN** a document that declares no viewpoints is rendered
- **THEN** no viewpoint selection is offered

#### Scenario: SelectingAViewpointDoesNotAlterTheDocument
- **WHEN** a reader selects a viewpoint
- **THEN** the document recovered for handover is unchanged

### Requirement: AFigureCarriesItsViewpoint

A figure produced while a viewpoint is applied — exported by a reader or written by the agent — SHALL
state inside the figure which viewpoint it shows and the concern that viewpoint frames, so a figure taken
out of the report it was written for still says what it is a reading of. The statement a narrowed figure
already makes about how much of the document it shows, and about hidden kinds remaining part of a
proposal, SHALL still be made.

A figure produced with a viewpoint and with no other adjustment SHALL be the same whether a reader
exported it or the agent wrote it.

#### Scenario: AnExportedFigureNamesItsViewpoint
- **WHEN** a reader exports a figure while a viewpoint is selected
- **THEN** the exported figure states that viewpoint's label and concern

#### Scenario: AProposalFigureStillSaysHiddenKindsRemain
- **WHEN** a figure of a proposal is produced for a viewpoint that hides some kinds
- **THEN** it states the viewpoint and that hidden kinds remain part of the proposal

#### Scenario: TheReaderAndTheAgentProduceTheSameViewpointFigure
- **WHEN** a reader exports a viewpoint's figure with no other adjustment and the agent writes a figure for the same viewpoint of the same document
- **THEN** both show the same elements, relationships, labels and statement

### Requirement: TheAgentCanWriteAFigureForAViewpoint

The agent's figure tool SHALL accept the identifier of a viewpoint the document declares, and SHALL write
the figure narrowed to it. Hidden kinds named in the same request SHALL apply on top of the viewpoint.

A viewpoint identifier the document does not declare SHALL be refused, and the refusal SHALL list the
identifiers the document does declare; naming a viewpoint for a document that declares none SHALL be
refused saying so. Nothing SHALL be written when a request is refused.

The result SHALL name the viewpoint the figure shows.

#### Scenario: AFigureIsWrittenForADeclaredViewpoint
- **WHEN** the agent requests a figure for a viewpoint the document declares
- **THEN** the figure is written showing what that viewpoint retains

#### Scenario: AnUndeclaredViewpointIsRefusedWithTheDeclaredOnes
- **WHEN** the agent names a viewpoint the document does not declare
- **THEN** the request is refused, the refusal lists the declared viewpoints, and nothing is written

#### Scenario: ADocumentWithoutViewpointsRefusesOne
- **WHEN** the agent names a viewpoint for a document that declares none
- **THEN** the request is refused saying the document declares no viewpoints, and nothing is written

#### Scenario: HiddenKindsApplyOnTopOfAViewpoint
- **WHEN** the agent names a viewpoint and also hides a kind that viewpoint retains
- **THEN** the figure shows the viewpoint without that kind

#### Scenario: TheResultNamesTheViewpoint
- **WHEN** a figure is written for a viewpoint
- **THEN** the result names the viewpoint it shows
