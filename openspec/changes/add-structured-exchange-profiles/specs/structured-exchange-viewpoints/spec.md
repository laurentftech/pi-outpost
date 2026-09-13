## MODIFIED Requirements

### Requirement: TheAgentCanWriteAFigureForAViewpoint

The agent's figure tool SHALL accept the identifier of a viewpoint the document declares, or one the
profile the document is held to declares, and SHALL write the figure narrowed to it. A viewpoint the
document declares SHALL be looked up first; a profile's viewpoint resolves against the document exactly as
a declared one does. Hidden kinds named in the same request SHALL apply on top of the viewpoint.

A document declaring a viewpoint whose identifier its profile also declares SHALL be refused, naming both,
since either choice would be a guess. A profile's viewpoint that retains no kind present in the document
SHALL be refused rather than drawn empty.

A viewpoint identifier neither the document nor its profile declares SHALL be refused, and the refusal
SHALL list the identifiers each declares; naming a viewpoint when neither declares any SHALL be refused
saying so. Nothing SHALL be written when a request is refused.

The result SHALL name the viewpoint the figure shows, and whether it came from the document or its profile.

#### Scenario: AFigureIsWrittenForADeclaredViewpoint
- **WHEN** the agent requests a figure for a viewpoint the document declares
- **THEN** the figure is written showing what that viewpoint retains

#### Scenario: AFigureIsWrittenForAProfileViewpoint
- **WHEN** the agent requests a figure for a viewpoint the document does not declare and its profile does
- **THEN** the figure is written showing what that viewpoint retains of the document, and the result says the viewpoint came from the profile

#### Scenario: AViewpointDeclaredByBothIsRefused
- **WHEN** a document declares a viewpoint whose identifier its profile also declares
- **THEN** the request is refused naming both, and nothing is written

#### Scenario: AProfileViewpointRetainingNothingOfTheDocumentIsRefused
- **WHEN** the agent names a profile viewpoint none of whose kinds occur in the document
- **THEN** the request is refused saying so, and nothing is written

#### Scenario: AnUndeclaredViewpointIsRefusedWithTheDeclaredOnes
- **WHEN** the agent names a viewpoint neither the document nor its profile declares
- **THEN** the request is refused, the refusal lists the viewpoints each declares, and nothing is written

#### Scenario: ADocumentWithoutViewpointsRefusesOne
- **WHEN** the agent names a viewpoint for a document that declares none and is held to no profile declaring any
- **THEN** the request is refused saying no viewpoints are declared, and nothing is written

#### Scenario: HiddenKindsApplyOnTopOfAViewpoint
- **WHEN** the agent names a viewpoint and also hides a kind that viewpoint retains
- **THEN** the figure shows the viewpoint without that kind

#### Scenario: TheResultNamesTheViewpoint
- **WHEN** a figure is written for a viewpoint
- **THEN** the result names the viewpoint it shows
