## Purpose

Enriches structured exchanges with domain-owned properties, concurrency context, navigable source
locations, and integrity-bound artifact links without teaching the core application a domain model.

## ADDED Requirements

### Requirement: CompatibleVersionedExtension

The system SHALL publish the enriched contract as a new Git-tracked structured-exchange schema with
a stable version-specific identifier. It SHALL continue to accept and present valid version 1
documents according to their original contract, and SHALL select validation solely from the declared
schema identifier.

Validation of either version MUST NOT retrieve a schema, profile, vocabulary, location, or linked
artifact over the network.

#### Scenario: VersionOneRemainsValid
- **WHEN** a document valid under version 1 is received after the enriched contract is installed
- **THEN** it is validated and presented with version 1 semantics unchanged

#### Scenario: VersionTwoSelectsItsOwnContract
- **WHEN** a document declares the enriched schema identifier
- **THEN** it is validated against the committed enriched schema and its semantic rules

#### Scenario: ValidationStaysOffline
- **WHEN** a document names a profile, locations, and linked artifacts
- **THEN** validation completes without retrieving any of them

### Requirement: OpaqueOptionalProfile

An enriched envelope MAY name one bounded, non-empty profile identifier. The profile SHALL identify
the vocabulary that owns kinds and attribute names, but the core application SHALL treat it as an
opaque value: it MUST NOT infer domain semantics from it, fetch it, execute it, or reject an otherwise
valid envelope merely because the profile is unknown.

The profile identifier SHALL survive validation, presentation, approval, and recovery unaltered. A
producer or receiving authority MAY apply additional profile-specific validation outside the core
contract.

#### Scenario: UnknownProfileUsesGenericPresentation
- **WHEN** a valid enriched envelope names a profile the application does not know
- **THEN** the application presents it generically and preserves the profile identifier unchanged

#### Scenario: ProfileDoesNotSupplyExecutableBehavior
- **WHEN** a profile identifier resembles a URL, module name, or executable instruction
- **THEN** the application treats it only as inert text and does not retrieve or execute it

#### Scenario: ProfileIsOptional
- **WHEN** a valid enriched envelope carries attributes but names no profile
- **THEN** core validation accepts the attributes and the application presents their names and values generically

### Requirement: BoundedTypedAttributes

An enriched graph element, graph relationship, sequence participant, or sequence message MAY declare
a bounded map of attributes describing that item. Attribute names SHALL be bounded, non-empty opaque
strings. An attribute value SHALL be a bounded string, finite number, boolean, null, opaque reference,
or bounded non-recursive list of those values. Arbitrary nested objects and executable values SHALL
be rejected.

On a referenced item in a proposal, descriptive attributes SHALL describe the current item. Proposed
attribute assignments SHALL be declared inside its change, and proposed removal of an attribute
SHALL be declared by naming that attribute explicitly. Omitted attributes SHALL remain untouched. A
single change MUST NOT both assign and remove the same attribute.

#### Scenario: AttributesRemainDomainOwned
- **WHEN** a valid item carries attribute names unknown to the application
- **THEN** their names and typed values are preserved and presented without domain interpretation

#### Scenario: AttributeChangeIsExplicit
- **WHEN** a proposal describes a current attribute and declares a different value in the item's change
- **THEN** the presentation distinguishes the current value from the proposed value

#### Scenario: OmittedAttributeRemainsUntouched
- **WHEN** a referenced item has attributes but its change omits one of them
- **THEN** the omitted attribute is neither presented nor recovered as changed or removed

#### Scenario: AttributeRemovalIsExplicit
- **WHEN** a proposal explicitly names an attribute for removal
- **THEN** the presentation identifies that attribute as removed rather than assigning it a null value

#### Scenario: ContradictoryAttributeChangeIsRejected
- **WHEN** one change both assigns and removes the same attribute name
- **THEN** semantic validation rejects the envelope with a diagnostic naming that attribute

#### Scenario: RecursiveAttributeValueIsRejected
- **WHEN** an attribute value contains an arbitrary nested object or nested list
- **THEN** schema validation rejects the envelope

### Requirement: TargetRevisionAndExpectations

An enriched proposal SHALL represent its target as an object containing the target's opaque reference
and MAY include the opaque revision from which the proposal was prepared. The presence of the target
object alone SHALL continue to determine that the envelope is a proposal.

A referenced item in a proposal MAY declare bounded expected current fields and attributes. An
expectation SHALL be understood as a precondition for the receiving authority, not as a change. The
application SHALL validate the structure of expectations and present them to the reader, but SHALL
NOT claim to verify them against an authority it does not own.

Target revisions and expectations SHALL be permitted only in proposals. They SHALL survive approval
and recovery unaltered so the receiving authority can refuse a stale or conflicting proposal.

#### Scenario: RevisionTravelsWithProposal
- **WHEN** a proposal names the revision of its target
- **THEN** the revision is visibly associated with the proposal and is recovered unchanged after approval

#### Scenario: RevisionDoesNotDefineProposalMode
- **WHEN** a target object is present without a revision
- **THEN** the envelope is still treated as a proposal

#### Scenario: ExpectationIsNotPresentedAsAChange
- **WHEN** a referenced item declares an expected current value and a proposed value
- **THEN** the presentation distinguishes the precondition from the proposed change

#### Scenario: ExpectationOutsideProposalIsRejected
- **WHEN** an envelope without a target declares an expected current value or target revision
- **THEN** semantic validation rejects it

#### Scenario: AuthorityCanReceiveConcurrencyContext
- **WHEN** an approved proposal carrying a target revision and expectations is recovered for handover
- **THEN** all concurrency context is present exactly as validated for the authority to check before applying it

### Requirement: NavigableLocationHints

An enriched addressable item MAY carry a bounded location consisting of an opaque URI, an optional
opaque revision, and an optional zero-based start and end position. When both positions are present,
the end MUST NOT precede the start.

A location SHALL be a navigation hint and MUST NOT replace, modify, or supply the item's identity or
reference. The application SHALL preserve and display the location as inert data. It MAY offer an
explicit navigation action only through its existing URI and workspace safety policy; it MUST NOT
open or retrieve a producer-supplied location automatically.

#### Scenario: LocationDoesNotBecomeIdentity
- **WHEN** two items carry the same location but different identifiers or references
- **THEN** they remain distinct items and validation does not merge them

#### Scenario: StaleLocationDoesNotChangeReference
- **WHEN** an item's location revision differs from the proposal's target revision
- **THEN** both opaque values are preserved and the location is not used to rewrite or resolve the reference

#### Scenario: InvalidRangeIsRejected
- **WHEN** a location's end position precedes its start position
- **THEN** semantic validation rejects the envelope with a diagnostic pointing to the range

#### Scenario: NavigationRequiresReaderAction
- **WHEN** a valid presentation contains a location URI
- **THEN** no resource is opened or retrieved until the reader explicitly invokes an allowed navigation action

### Requirement: IntegrityBoundArtifactLinks

An enriched envelope or addressable item MAY carry a bounded list of related artifact links. Each
link SHALL declare an opaque relationship, a bounded URI, and a SHA-256 digest of the artifact bytes,
and MAY declare a bounded media type and label. The link SHALL reference content rather than embedding
the content in the structured-exchange document.

The application SHALL preserve and present artifact links as inert metadata. It MUST NOT retrieve,
render, execute, or trust linked content during validation. Any later retrieval SHALL require an
explicit reader action, SHALL use the application's existing resource safety boundary, and SHALL
report a digest mismatch before the artifact is used.

#### Scenario: ArtifactLinkIsPresentedWithoutRetrieval
- **WHEN** a valid envelope carries a linked implementation or verification artifact
- **THEN** its relationship, label, media type, URI, and digest are available to the reader without fetching it

#### Scenario: EmbeddedArtifactPayloadIsRejected
- **WHEN** a producer places an inline binary or unbounded payload where an artifact link is expected
- **THEN** schema validation rejects the envelope

#### Scenario: DigestMismatchPreventsUse
- **WHEN** a reader explicitly retrieves a linked artifact whose bytes do not match its declared digest
- **THEN** the application reports the mismatch and does not open or apply the artifact

### Requirement: EnrichedInformationIsAccessibleAndRecoverable

The native presentation and its accessible textual equivalent SHALL expose the envelope's profile,
target revision, expectations, attributes, locations, and artifact links without interpreting
producer-controlled text as markup or executable content. A proposal view SHALL distinguish current
descriptions, expectations, proposed assignments, and proposed removals.

Approval and recovery SHALL retain every enriched field exactly as validated. A derived diagram
export MAY omit non-structural enrichment, but MUST NOT manufacture structure or silently become the
document handed to the receiving authority.

#### Scenario: GenericPresentationShowsEnrichment
- **WHEN** a valid enriched document contains every enrichment defined by this capability
- **THEN** each enrichment is available in both the native presentation and its accessible textual equivalent

#### Scenario: ProposalSeparatesConditionsFromChanges
- **WHEN** a proposal carries descriptions, expectations, assignments, and attribute removals
- **THEN** a reader can distinguish all four roles before approving it

#### Scenario: EnrichmentSurvivesApproval
- **WHEN** an enriched proposal is approved and recovered for handover
- **THEN** its profile, attributes, revision, expectations, locations, and artifact links are unchanged

#### Scenario: ProducerTextRemainsInert
- **WHEN** an enriched field contains markup-like or diagram-like text
- **THEN** it is displayed as text and neither executed nor interpreted as presentation syntax

### Requirement: EnrichedContractCarriesTheWholeVersionOneVocabulary

The enriched schema SHALL carry forward every construct the version 1 contract defines — including
containers, declared element and relationship kinds, removals, `set` patches, and the change role a
table row may declare — so that anything expressible under version 1 is expressible under the
enriched contract without loss. The enriched contract SHALL only add.

Every view derived from a document SHALL treat the two versions alike: a figure written for an
enriched document SHALL draw the same structure it draws for the version 1 equivalent, and a table
SHALL leave as data on the same terms. A derived view MAY omit non-structural enrichment it has no
place for, and SHALL say inside the view that it shows less than the document holds.

#### Scenario: AVersionOneDocumentReExpressedLosesNothing
- **WHEN** a version 1 document declaring containers, kinds, removals and row roles is re-expressed under the enriched schema with only its schema identifier changed
- **THEN** it is valid, and its containers, kinds, removals and row roles carry the same meaning

#### Scenario: AnEnrichedFigureDrawsTheSameStructure
- **WHEN** a figure is produced from an enriched document and from its version 1 equivalent
- **THEN** both show the same elements, relationships and containers

#### Scenario: AnEnrichedTableLeavesAsData
- **WHEN** an enriched table is exported as data
- **THEN** its columns, rows and declared roles leave as they do under version 1

### Requirement: AddressableTypedTableRows

A row of an enriched table MAY declare an identity of its own: a document-local `id`, an opaque `ref`
owned by an external authority, and an opaque `kind` naming what the row is — a requirement, a test,
a chapter's content, whatever the profile owns. A row MAY carry attributes, expectations, locations,
artifact links and a `set` patch on the same terms as any other addressable item.

Because a row can now be addressed, an enriched table MAY be proposed: it may carry a target, its
rows may carry `set` patches, and a removal may name a row. Version 1 keeps its own answer — a table
whose rows are anonymous tuples has nothing for a change to address, and a version 1 table carrying a
target SHALL still be refused.

Row identity SHALL be governed by the rules identity already has: `id` SHALL be unique within the
document, `ref` SHALL be treated as opaque and never parsed, and a row carrying no `ref` SHALL read as
new. A row's declared `kind` SHALL NOT be inferred from a cell's value or a column's name, and SHALL
NOT be an instruction. A row that declares an identity SHALL still align to the table's columns.

#### Scenario: ARequirementRowIsAddressable
- **WHEN** a table declares a row with `id`, `ref` and `kind` of `requirement`
- **THEN** the row is validated, presented with its kind, and recovered with its identity unchanged

#### Scenario: DuplicateRowIdsAreRejected
- **WHEN** two rows of the same document declare the same `id`
- **THEN** the envelope is rejected, naming the repeated identifier

#### Scenario: ATypedRowStillAlignsToItsColumns
- **WHEN** a row declaring an identity carries more or fewer cells than the table declares columns
- **THEN** it is rejected, naming the row, the count of cells and the count of columns

#### Scenario: AnEnrichedTableCanBeProposed
- **WHEN** an enriched table names a target and patches one of its rows by reference
- **THEN** the proposal is accepted and the row's change is presented for approval

#### Scenario: AVersionOneTableStillCannotBeProposed
- **WHEN** a version 1 table carries a target
- **THEN** it is refused, as it was before rows could be addressed

#### Scenario: ARowKindIsNotInferredFromData
- **WHEN** a table carries a column whose values name row types and no row declares a `kind`
- **THEN** those values are rendered as data and no row is treated as typed

### Requirement: TraceabilityRelationsBetweenRows

An enriched table MAY declare relations between its rows: each relation declares `from`, `to`, and an
opaque `kind` — `satisfies`, `verifies`, `derives`, whatever the profile owns — on the same terms as a
relationship between graph elements. An endpoint SHALL name a row's document-local `id` or an opaque
`ref`; an endpoint naming neither a declared row nor a `ref` SHALL be rejected, naming the relation and
the endpoint that does not resolve. A relation MAY point at a `ref` the document does not itself carry,
so traceability MAY cross documents and authorities.

The presentation SHALL make every declared relation perceptible without a reader hunting for it: a row
SHALL show the relations it takes part in, in both directions, and the accessible textual equivalent
SHALL carry the same relations. A rendering carrying relations SHALL provide a key naming every
relation kind it shows. The application SHALL NOT infer, complete, or act on a relation, and SHALL NOT
treat an absent relation as a finding about coverage.

#### Scenario: ARequirementIsLinkedToWhatSatisfiesIt
- **WHEN** a table declares a relation of kind `satisfies` from one requirement row to another
- **THEN** both rows show the relation, naming its kind and its other end

#### Scenario: ARelationMayLeaveTheDocument
- **WHEN** a relation names a `ref` no row in the document declares
- **THEN** it is accepted and presented as pointing outside the document

#### Scenario: AnUnresolvableEndpointIsRejected
- **WHEN** a relation names a document-local id no row declares
- **THEN** the envelope is rejected, naming the relation and the endpoint

#### Scenario: TheKeyNamesEveryRelationKindShown
- **WHEN** a table carrying relations is rendered
- **THEN** a key names every relation kind present, and the textual equivalent names the same kinds the same way

#### Scenario: MissingTraceabilityIsNotAFinding
- **WHEN** a requirement row takes part in no relation
- **THEN** it is presented as it is, and the application states nothing about its coverage

### Requirement: StructuralRowsOrganiseATable

A row of an enriched table MAY be structural rather than data: it declares a heading and an optional
nesting level, and SHALL NOT be required to align to the table's columns. A structural row SHALL be
presented as a heading spanning the table, at its declared depth, in document order among the rows it
introduces. A structural row MAY declare a change role and an identity on the same terms as any other
row.

Every representation of the table SHALL carry its structural rows: the accessible textual equivalent,
the data export, and any document the table is written into SHALL preserve each heading, its depth,
and its position among the rows. A structural row SHALL NOT be counted as a row of data, and SHALL NOT
be inferred from a data row whose cells happen to be empty or repeated.

#### Scenario: ChaptersDivideARequirementsTable
- **WHEN** a table declares structural rows between groups of requirement rows
- **THEN** each is presented as a heading spanning the table, in its declared position and depth

#### Scenario: AStructuralRowNeedsNoCells
- **WHEN** a structural row declares a heading and no cells
- **THEN** it is accepted, and the column-alignment rule is not applied to it

#### Scenario: ExportsKeepTheChapters
- **WHEN** a table carrying structural rows leaves as data or is written into a document
- **THEN** every heading, its depth and its position among the rows are preserved

#### Scenario: AnEmptyDataRowIsNotAChapter
- **WHEN** a data row carries empty cells
- **THEN** it remains a row of data and is not presented as a heading

### Requirement: AnEnrichedTableMayBeProposed

Under the enriched contract a table SHALL be permitted to name a target and declare removals, which
version 1 refuses. Version 1 called a table a projection because its rows were anonymous tuples:
there was nothing in one for a change to address. An enriched row carries the two identities every
other addressable item has, so a change to it addresses a thing rather than a position.

A version 1 table SHALL continue to be refused when it names a target or declares a removal. The
permission belongs to the enriched contract alone, and a producer who wrote against version 1 SHALL
find its rule unchanged.

A row SHALL NOT both declare a change role and carry a change. A declared role states what the
producer observed in the authority it projected and is acted on by nobody; a change states what the
producer asks for. On one row the two may disagree, and the system SHALL refuse rather than decide
which prevails. In a proposal the role of a row SHALL be derived from the proposal itself — a
referenced row carrying a change is a change, a row carrying no reference is an addition, and a row
named in `removals` is a removal.

#### Scenario: AnEnrichedTableCarriesATargetAndRevision
- **WHEN** an enriched table names the artifact it was extracted from and the revision it was read at
- **THEN** it is accepted as a proposal, and the revision is carried through approval unchanged

#### Scenario: AVersionOneTableStillCannotBeProposed
- **WHEN** a version 1 table names a target or declares a removal
- **THEN** it is rejected, as it was before the enriched contract existed

#### Scenario: ARowThatReportsAndAsksAtOnceIsRefused
- **WHEN** a row declares a change role and also carries a change
- **THEN** the envelope is rejected, naming that row

#### Scenario: AProposedRowIsMarkedFromWhatItProposes
- **WHEN** an enriched proposal changes one row, adds another, and names a third among its removals
- **THEN** each is marked as a change, an addition and a removal without any of them declaring a role
