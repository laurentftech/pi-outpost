# structured-exchange-appearance Specification

## Purpose
Lets a project give the kinds its documents use the colours of its own conventions — reviews in red,
phases in the colours of the planning tool everyone reads — declared once for the project rather than
written into each document, and applied wherever a kind is coloured.

## Requirements

### Requirement: AProjectDeclaresKindColoursInItsRegistry

A version 2 registry MAY declare an `appearance` object with two optional maps: `kinds`, for the kinds of
elements, participants, table rows and timeline items, and `relationshipKinds`, for the kinds of
relationships and table relations. Each map SHALL associate a kind name with an object declaring a
`color`, written as a six-digit hexadecimal colour (`#rrggbb`). Kind names SHALL be matched by exact
string equality; a name in one map SHALL NOT colour the other vocabulary.

The appearance section SHALL be validated with the rest of the registry: a malformed colour, an unknown
property, or a map past its ceiling SHALL make the registry unusable exactly as any other registry fault
does. A version 1 registry SHALL declare no appearance, and SHALL be read exactly as before.

#### Scenario: AColourIsDeclaredForAKind
- **WHEN** a version 2 registry declares `"appearance": { "kinds": { "SRR": { "color": "#dc2626" } } }`
- **THEN** the registry is valid, and the project's appearance gives kind `SRR` the colour `#dc2626`

#### Scenario: AMalformedColourMakesTheRegistryUnusable
- **WHEN** the registry declares `"color": "red"` for a kind
- **THEN** the registry is unusable, and the refusal names the registry file, the rule and a pointer to that colour

#### Scenario: VocabulariesAreSeparate
- **WHEN** the registry colours relationship kind `power`, and a graph has an element of kind `power`
- **THEN** the element keeps its automatic colour

#### Scenario: AVersionOneRegistryIsUnchanged
- **WHEN** a version 1 registry that was valid before is read
- **THEN** it is valid, means what it meant, and declares no appearance

### Requirement: ProjectColoursApplyWhereverAKindIsColoured

Wherever the reader colours a kind — a graph's elements and relationships, a sequence's participants, a
timeline's activities and milestones, and their legends — a kind the project's appearance names SHALL be
drawn in its declared colour, with the lighter fills the renderer derives from it. This SHALL hold for a
document presented by a tool, a structured-exchange block in a reply, and a file opened in the viewer, and
for figures written by `write_structure_figure`.

A kind the appearance does not name SHALL keep its automatic colour, and the automatic assignment SHALL NOT
give it a palette colour equal to a declared colour drawn in the same figure. A project without an
appearance, or without a registry, SHALL see exactly the colours it saw before.

No document SHALL change: the appearance is read from the project, never written into or carried by a
structured-exchange document.

#### Scenario: ATimelineMilestoneTakesItsProjectColour
- **WHEN** the project colours kind `SRR` `#dc2626` and a timeline shows an `SRR` milestone
- **THEN** the star and its legend entry are drawn in `#dc2626`

#### Scenario: AGraphElementTakesItsProjectColour
- **WHEN** the project colours kind `sensor` and a graph shows an element of kind `sensor`
- **THEN** the element's outline and legend entry are drawn in that colour

#### Scenario: AnUnnamedKindKeepsAnAutomaticColourDistinctFromDeclaredOnes
- **WHEN** a drawing shows a declared kind and an undeclared one whose automatic colour would equal the declared colour
- **THEN** the undeclared kind is drawn in a different palette colour

#### Scenario: TheFigureWriterUsesProjectColours
- **WHEN** the agent writes a figure of a graph whose kinds the project colours
- **THEN** the written SVG uses the declared colours

#### Scenario: NoAppearanceChangesNothing
- **WHEN** a project has no registry, or a registry without appearance
- **THEN** every kind is drawn in the colour it was drawn in before

#### Scenario: TheDocumentIsUntouched
- **WHEN** a document is drawn with project colours and its envelope is shown or recovered
- **THEN** it is byte-for-byte the document that was presented, with no colour in it

### Requirement: TheReaderIsToldAColourIsTheProjects

A legend entry whose colour comes from the project SHALL say so, in its accessible name and on hover. When
two kinds shown in the same drawing are given the same declared colour, the legend SHALL say that they
share it; neither SHALL be recoloured.

#### Scenario: ALegendMarksAProjectColour
- **WHEN** a legend shows a kind the project colours
- **THEN** that entry is marked as a project colour

#### Scenario: ASharedDeclaredColourIsSaid
- **WHEN** the project gives `SRR` and `PDR` the same colour and a timeline shows both
- **THEN** both keep that colour, and the legend says they share it

### Requirement: TheAppearanceIsReadAsItIsNow

The server SHALL read the project's appearance from the registry on disk and send it to the project's
readers with every session snapshot and after every presented document or reply that carries a
structured-exchange document, so that an edited registry takes effect without a restart. When the registry
is saved from the application's own file viewer, the server SHALL send it again at once. When the registry
is unusable or absent, the readers SHALL be sent no appearance, and automatic colours apply.

#### Scenario: AnEditedRegistryRecoloursTheNextDocument
- **WHEN** the registry's colour for `SRR` is changed and the agent then presents a timeline
- **THEN** the reader draws `SRR` in the new colour, with no restart

#### Scenario: ARegistrySavedInTheViewerRecoloursAtOnce
- **WHEN** the reader edits the registry's colour for `SRR` in the file viewer and saves it
- **THEN** every reader of the project is sent the new appearance, and drawings use it without a reload

#### Scenario: AnUnusableRegistrySendsNoAppearance
- **WHEN** the registry becomes unusable
- **THEN** the reader draws every kind in its automatic colour
