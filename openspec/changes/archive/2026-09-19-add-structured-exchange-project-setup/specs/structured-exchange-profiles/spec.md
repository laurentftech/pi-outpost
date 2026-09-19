## MODIFIED Requirements

### Requirement: APublishedProfileFormat

The system SHALL publish a profile format with the stable identifier `urn:structured-exchange-profile:1`
and a committed, Git-tracked JSON Schema. A profile SHALL declare its identifier, a label, and:

- the element kinds it allows, which govern graph elements and table rows;
- the relationship kinds it allows, which govern graph relationships and table relations;
- for each kind, the attributes that kind may carry, each with a type — string, number, boolean,
  reference, or enumeration — whether it is required, and whether it holds a list;
- for each enumeration, its allowed values and whether it is closed or open;
- optionally, for each relationship kind, the element kinds allowed at its source and the element kinds
  allowed at its target; a side left undeclared allows any element kind;
- optionally, viewpoints in the same shape a version 2 document declares them.

The format SHALL be flat: no inheritance between kinds and no references between profiles. A profile
SHALL be refused when it does not conform to its schema, when it declares a kind or an attribute of a
kind twice, when an enumeration has no values or repeats one, when a relationship kind's ends name an
element kind the profile does not declare or name one twice, when a viewpoint retains a kind the profile
does not declare, when two of its viewpoints share an identifier, when its identifier is one the contract
reserves, or when it exceeds the published ceilings on kinds, attributes, enumeration values and
viewpoints. Every refusal SHALL name a rule and point at the offending value.

Declaring ends is an addition to the published format: a profile that declares them SHALL be documented as
refused by a validator or an application that predates them.

#### Scenario: AProfileDeclaresKindsAttributesAndEnumerations
- **WHEN** a profile declares a `requirement` element kind with a required closed enumeration `status` of `draft`, `approved` and `withdrawn`
- **THEN** the profile is usable and those constraints apply to documents held to it

#### Scenario: AnUnknownProfileFieldIsRefused
- **WHEN** a profile carries a field its schema does not define
- **THEN** the profile is refused with the rule and a pointer to the field

#### Scenario: AnEnumerationWithoutValuesIsRefused
- **WHEN** a profile declares an enumeration attribute with no allowed values
- **THEN** the profile is refused with the rule and a pointer to the attribute

#### Scenario: ARepeatedEnumerationValueIsRefused
- **WHEN** a profile lists the same enumeration value twice
- **THEN** the profile is refused with the rule and a pointer to the repeated value

#### Scenario: AProfileViewpointRetainingAnUndeclaredKindIsRefused
- **WHEN** a profile's viewpoint retains a kind the profile does not declare
- **THEN** the profile is refused with the rule and a pointer to that kind

#### Scenario: AProfileBeyondItsCeilingsIsRefused
- **WHEN** a profile declares more enumeration values for one attribute than the published ceiling allows
- **THEN** the profile is refused naming the ceiling

#### Scenario: AProfileClaimingAReservedIdentifierIsRefused
- **WHEN** a profile declares the identifier `urn:structured-exchange-conformity-report:1`
- **THEN** the profile is refused with the rule and a pointer to its identifier

#### Scenario: AProfileClaimingAViewIdentifierIsRefused
- **WHEN** a profile declares the identifier `urn:structured-exchange-rule-patterns:1`
- **THEN** the profile is refused with the rule and a pointer to its identifier

#### Scenario: ARelationshipKindDeclaresItsEnds
- **WHEN** a profile declares the `verifies` relationship kind with `test` allowed at its source and `requirement` at its target
- **THEN** the profile is usable and those ends apply to documents held to it

#### Scenario: AnEndNamingAnUndeclaredKindIsRefused
- **WHEN** a relationship kind's source names the element kind `tset`, which the profile does not declare
- **THEN** the profile is refused with the rule, a pointer to `tset` and the element kinds the profile declares

#### Scenario: AnEndNamingAKindTwiceIsRefused
- **WHEN** a relationship kind's target names `requirement` twice
- **THEN** the profile is refused with the rule and a pointer to the second

### Requirement: ADocumentIsHeldToItsProfile

A version 2 graph or table document SHALL be held to a profile when it names a registered profile, or
when it names none in a project whose registry declares a default, in which case it is held to the
default. Holding a document to its profile SHALL happen only after the document satisfies the core
contract.

In a project that registers profiles, a refusal by the core contract SHALL say that it comes from the
contract and not from the project's profile, so that the producer does not look for the cause in the
profile.

A document held to a profile SHALL be refused when:

- an element, row, relationship or relation carries a kind the profile does not declare in the
  corresponding vocabulary;
- an element, relationship or relation carries no kind, or a row that is not a structural heading
  carries none;
- an item carries an attribute its kind does not declare;
- an attribute's value does not have the declared type, or is a list where the attribute is not one, or
  a single value where it is;
- a value of a closed enumeration is not one of its allowed values;
- an item of a complete document, or an item a proposal adds, omits an attribute its kind requires;
- any item sets an attribute its kind requires to null;
- a proposal removes an attribute its kind requires;
- a relationship or relation joins, at an end its kind declares, an item of the document whose kind that
  end does not allow.

An item a proposal adds is one that carries no reference: nothing exists yet for it to leave unchanged, so
it must carry every required attribute, exactly as in a complete document. A proposal SHALL NOT be refused
for required attributes it does not mention on an item it changes, because it describes only what
changes. A changed item SHALL still state its kind, so that its attributes can be checked. Structural
heading rows SHALL NOT be held to kinds or attributes.

A relationship's ends SHALL be judged by the kinds a proposal leaves its items and itself with. An end that
is not an item of the document, or is an item carrying no kind, SHALL NOT cause a refusal: its kind cannot be
verified here, and it SHALL be reported as a finding to check with a pointer to the relationship. When a
document is checked with a stated set of subjects, only relationships with a subject at one end at least
SHALL be judged by their ends.

When the agent is refused a kind, an attribute, a closed-enumeration value or a relationship between kinds the
profile does not have, the refusal SHALL also tell it not to substitute an allowed one it has no grounds for,
and to ask the user which is true or whether the profile should change.

Each refusal SHALL name the rule, point at the offending value, and state what the profile allows at that
point — for a kind, the kinds declared in that vocabulary; for an attribute, the attributes the kind
declares; for a closed enumeration, its allowed values; for an end, the element kinds the relationship kind
allows there. Nothing SHALL be presented when a document is refused, and nothing SHALL be corrected on the
producer's behalf.

Sequence documents SHALL NOT be held to a profile.

#### Scenario: AConformingDocumentIsPresented
- **WHEN** a document names a registered profile and satisfies every constraint it declares
- **THEN** the document is presented

#### Scenario: AnUndeclaredKindIsRefusedWithTheDeclaredOnes
- **WHEN** a row carries the kind `requirment`, and the profile declares `requirement` and `heading-note`
- **THEN** the document is refused, the refusal points at the kind and lists the kinds the profile declares, and nothing is presented

#### Scenario: AnUntypedItemIsRefused
- **WHEN** a graph element in a document held to a profile carries no kind
- **THEN** the document is refused with the rule and a pointer to the element

#### Scenario: AStructuralHeadingIsNotHeldToKinds
- **WHEN** a table held to a profile contains a structural heading row with no kind and no attributes
- **THEN** the heading does not cause a refusal

#### Scenario: AnAttributeTheKindDoesNotHaveIsRefused
- **WHEN** an item carries an attribute its kind does not declare
- **THEN** the document is refused, the refusal points at the attribute and lists the attributes the kind declares

#### Scenario: AValueOfTheWrongTypeIsRefused
- **WHEN** a number attribute carries the string `"12"`
- **THEN** the document is refused with the rule and a pointer to the value

#### Scenario: AListWhereOneValueIsDeclaredIsRefused
- **WHEN** an attribute declared as a single value carries a list
- **THEN** the document is refused with the rule and a pointer to the value

#### Scenario: AValueOutsideAClosedEnumerationIsRefusedWithTheAllowedValues
- **WHEN** a closed enumeration attribute carries a value the profile does not allow
- **THEN** the document is refused, and the refusal points at the value and lists every allowed value

#### Scenario: AMissingRequiredAttributeIsRefused
- **WHEN** a complete document contains an item whose kind requires an attribute it does not carry
- **THEN** the document is refused with the rule and a pointer to the item

#### Scenario: ANullRequiredAttributeIsRefused
- **WHEN** a complete document sets a required attribute to null
- **THEN** the document is refused with the rule and a pointer to the value

#### Scenario: AProposalIsNotRefusedForAttributesItDoesNotMention
- **WHEN** a proposal changes one attribute of an item whose kind requires others the proposal does not mention
- **THEN** the proposal is not refused for the attributes it does not mention

#### Scenario: AnItemAProposalAddsCarriesItsRequiredAttributes
- **WHEN** a proposal adds a row with no reference whose kind requires an attribute the row does not carry
- **THEN** the proposal is refused with the rule and a pointer to the row

#### Scenario: AProposalMayNotRemoveARequiredAttribute
- **WHEN** a proposal removes an attribute the item's kind requires
- **THEN** the proposal is refused with the rule and a pointer to the removal

#### Scenario: ADocumentNamingNoProfileIsHeldToTheDefault
- **WHEN** a document names no profile in a project whose registry declares a default
- **THEN** the document is held to the default profile

#### Scenario: CoreViolationsAreReportedFirst
- **WHEN** a document both breaks the core contract and strays from its profile
- **THEN** the refusal reports the core violations, and the profile is applied once they are fixed

#### Scenario: AVocabularyRefusalTellsTheAgentToAskRatherThanPick
- **WHEN** the agent presents a requirement whose status is a value outside the profile's closed enumeration
- **THEN** the refusal tells it to ask the user rather than replace the value with an allowed one

#### Scenario: ACoreRefusalSaysItIsNotTheProfile
- **WHEN** a document breaks the core contract in a project that registers profiles
- **THEN** the refusal says it comes from the structured-exchange contract and not from the project's profile

#### Scenario: ASequenceIsNotHeldToAProfile
- **WHEN** a sequence document names a registered profile
- **THEN** it is validated by the core contract alone

#### Scenario: ARelationshipBetweenKindsItsEndsDoNotAllowIsRefused
- **WHEN** a graph holds a `verifies` relationship from a `requirement` to a `requirement`, and the profile allows only `test` at the source of `verifies`
- **THEN** the document is refused, the refusal points at the relationship's source and lists `test`, tells the agent to ask rather than pick, and nothing is presented

#### Scenario: ATableRelationIsHeldToItsEnds
- **WHEN** a table holds a `verifies` relation whose target is a `test` row, and the profile allows only `requirement` at the target of `verifies`
- **THEN** the document is refused with the rule and a pointer to the relation's target

#### Scenario: AnUndeclaredSideAllowsAnyKind
- **WHEN** the profile declares the source of `verifies` and not its target, and a `verifies` relationship goes from a `test` to a `test`
- **THEN** the relationship's ends cause no refusal

#### Scenario: AnEndOutsideTheDocumentIsAFindingToCheck
- **WHEN** a `verifies` relation's source is a reference to an object the document does not carry, and the profile declares the source of `verifies`
- **THEN** the document is presented, and the agent's result lists a finding to check pointing at the relation

#### Scenario: AProposalIsJudgedByTheKindsItLeaves
- **WHEN** a proposal changes the kind of an element from `test` to `requirement`, and a `verifies` relationship in the proposal has that element as its source, where only `test` is allowed
- **THEN** the proposal is refused with the rule and a pointer to the relationship's source

### Requirement: AProjectWithADefaultAdmitsNoWayAround

In a project whose registry declares a default profile, the agent SHALL NOT be able to step around the
model by what a document declares. A document naming a profile the registry does not register SHALL be
refused, listing the registered profiles, and a version 1 document, which cannot name a profile, SHALL be
refused saying the project's documents follow its default profile under version 2.

In a project whose registry declares no default, a document naming an unregistered profile or no profile,
and a version 1 document, SHALL be validated by the core contract alone.

A document naming a profile identifier the contract reserves — `urn:structured-exchange-conformity-report:1`,
which a conformity report names, `urn:structured-exchange-rules-register:1`, which a rules register names, and
`urn:structured-exchange-rule-patterns:1`, which rule patterns name — SHALL be validated by the core contract alone
in every project, whatever its registry's default: the identifier states what the document is, and no project's
model governs it.

#### Scenario: AnUnregisteredProfileIsRefusedUnderADefault
- **WHEN** a document names `acme/other` in a project whose registry declares a default and does not register `acme/other`
- **THEN** the document is refused, the refusal lists the registered profiles, and nothing is presented

#### Scenario: AVersionOneDocumentIsRefusedUnderADefault
- **WHEN** a version 1 document is presented in a project whose registry declares a default
- **THEN** the document is refused saying the project's documents follow its default profile under version 2

#### Scenario: WithoutADefaultAnUnregisteredProfileIsPresentedGenerically
- **WHEN** a document names an unregistered profile in a project whose registry declares no default
- **THEN** the document is validated by the core contract alone and presented generically

#### Scenario: AReservedIdentifierIsNeverHeldToAProfile
- **WHEN** a document names `urn:structured-exchange-conformity-report:1` in a project whose registry declares a default
- **THEN** the document is validated by the core contract alone

#### Scenario: AViewIdentifierIsNeverHeldToAProfile
- **WHEN** a document names `urn:structured-exchange-rules-register:1` in a project whose registry declares a default
- **THEN** the document is validated by the core contract alone

### Requirement: TheReaderIsToldWhetherADocumentConforms

A presented document held to a profile SHALL state, in its rendering and in its accessible textual
equivalent, the profile it was checked against and that it conforms, with the number of values outside
open enumerations and the number of findings to check — violated `report` rules, rules not verifiable
here, and relationship ends whose kind cannot be verified here — when there are any. The statement SHALL be
established against the project's registry as it is when the document is shown, live or restored, and SHALL
say so when the registry cannot be used at that moment or the document no longer conforms.

The statement SHALL be carried beside the document, never inside it: the document handed on for approval
SHALL remain exactly the document that was validated. A document not held to a profile SHALL carry no
statement.

#### Scenario: AConformingDocumentSaysSo
- **WHEN** a document held to `acme/requirements` is presented
- **THEN** the rendering states that it conforms to `acme/requirements`

#### Scenario: OpenEnumerationValuesAreCounted
- **WHEN** a presented document carries two values outside open enumerations
- **THEN** the rendering states that it conforms with two values outside open enumerations

#### Scenario: FindingsToCheckAreCounted
- **WHEN** a presented document violates one `report` rule and has one rule not verifiable here
- **THEN** the rendering states that it conforms with two findings to check

#### Scenario: UnverifiableEndsAreCounted
- **WHEN** a presented document has one relation whose declared end is outside the document
- **THEN** the rendering states that it conforms with one finding to check

#### Scenario: ARestoredDocumentIsCheckedAgainstTheProfileAsItIsNow
- **WHEN** a session is restored after the profile was changed so that a previously presented document no longer conforms
- **THEN** the restored rendering states that the document no longer conforms to the profile

#### Scenario: NarrowedEndsApplyToARestoredDocument
- **WHEN** a session is restored after a relationship kind's ends were narrowed so that a presented relationship is no longer allowed
- **THEN** the restored rendering states that the document no longer conforms to the profile

#### Scenario: TheStatementDoesNotAlterTheDocument
- **WHEN** a document carrying a conformance statement is approved
- **THEN** the document handed on is byte-identical to the one that was validated

#### Scenario: ADocumentNotHeldToAProfileCarriesNoStatement
- **WHEN** a document is presented in a project without a registry
- **THEN** its rendering carries no conformance statement

### Requirement: TheReferenceValidatorChecksProfiles

The reference validation interface SHALL, without this application's sources:

- check a profile file on its own and report its verdict;
- check a rules file against the profile it names and report its verdict;
- check a project registry — its profiles and rules files together — and report its verdict;
- validate a document against a given profile file, applying the core contract and then the profile
  rules, and refusing a document that names a different profile identifier;
- validate a document against a project registry, applying the core contract, the profile and its rules;
- print a profile as a readable listing of every kind, every attribute with its type and whether it is
  required or a list, every enumeration value with whether the enumeration is closed or open, and for each
  relationship kind the element kinds allowed at its source and at its target, or that any is — nothing
  elided, so the profile can be reviewed by hand against the model it was built from — and, when given a
  registry, every rule with its identifier, level, source, statement and conditions, so each statement can be
  read beside what the rule checks.

The existing process statuses SHALL keep their meaning, and a profile, rules file or registry that is
unreadable, not JSON or does not conform SHALL be reported with a status distinct from a document that does not
conform, and documented.

#### Scenario: AProfileIsCheckedOnItsOwn
- **WHEN** a producer passes a profile file with an enumeration that repeats a value to the interface's profile check
- **THEN** it receives a machine-readable refusal naming the rule and a non-zero status

#### Scenario: ADocumentIsValidatedAgainstAProfile
- **WHEN** a producer validates a document carrying a value outside a closed enumeration against the profile that declares it
- **THEN** it receives the profile rule, a pointer to the value and the status for a non-conforming document

#### Scenario: AnUnusableProfileIsDistinguishedFromAStrayDocument
- **WHEN** a producer validates a document against a profile file that does not conform
- **THEN** the status differs from the one a non-conforming document produces

#### Scenario: AProfileIsListedForReview
- **WHEN** a producer asks for a readable listing of a profile whose enumeration declares forty values
- **THEN** the listing shows all forty values, marked as closed or open, under their attribute and kind

#### Scenario: ProfileChecksRunWhereTheProducerIs
- **WHEN** the published interface checks a profile outside this application, with none of its sources present
- **THEN** it reports its verdict

#### Scenario: ARulesFileIsCheckedAgainstItsProfile
- **WHEN** a producer checks a registry whose rules file names a value its profile does not list
- **THEN** it receives a machine-readable refusal naming the rules file, the rule and a pointer, with the status for an unusable profile

#### Scenario: ADocumentIsValidatedAgainstARegistry
- **WHEN** a producer validates a document violating a `refuse` rule against a project registry
- **THEN** it receives the rule's identifier, statement and pointer, and the status for a non-conforming document

#### Scenario: RulesAreListedBesideTheirStatements
- **WHEN** a producer asks for a readable listing of a registry whose rules file holds three rules
- **THEN** the listing shows each rule's identifier, level, source and statement beside the conditions it checks

#### Scenario: DeclaredEndsAreListed
- **WHEN** a producer asks for a readable listing of a profile whose `verifies` kind declares `test` at its source and nothing at its target
- **THEN** the listing shows `test` as the source of `verifies` and any element kind as its target
