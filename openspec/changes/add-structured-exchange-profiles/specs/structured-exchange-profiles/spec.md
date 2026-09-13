## Purpose

Lets a project declare the data model its structured-exchange documents must follow — kinds, attributes
and enumerations — in local profile files, and holds the agent's documents to it inside the refusal loop
the agent already works in, without ever retrieving anything.

## ADDED Requirements

### Requirement: AProjectDeclaresItsProfilesLocally

A project MAY declare structured-exchange profiles with a registry file at
`.pi-outpost/structured-exchange.json` in the project directory. The registry SHALL list the profile
files it registers, by paths relative to the project, and MAY name one registered profile as the
project's default.

Every registry and profile file SHALL be read from inside the project directory. A listed path that
resolves outside the project, including through a symbolic link, SHALL make the registry unusable.
Nothing SHALL be retrieved over the network, and a profile identifier SHALL be matched against the
registered profiles by exact string equality, never resolved, fetched or executed.

A document's profile SHALL be looked up in the registry as it is on disk when the document is checked,
so that editing a profile takes effect on the next check without restarting anything.

A project without a registry file SHALL be unconstrained: documents are validated by the core contract
alone, as they were before profiles existed.

#### Scenario: ARegisteredProfileIsFoundByItsIdentifier
- **WHEN** a project's registry lists a profile file whose profile identifier is `acme/requirements`, and a document names `acme/requirements`
- **THEN** the document is checked against that profile

#### Scenario: ARegistryPathLeavingTheProjectIsRefused
- **WHEN** the registry lists a profile path that resolves outside the project directory
- **THEN** the registry is unusable, and the refusal names the offending entry

#### Scenario: ProfilesAreNeverRetrieved
- **WHEN** a document names a profile identifier that looks like a URL, and the registry registers no profile with that exact identifier
- **THEN** nothing is retrieved, and the identifier is treated as unregistered

#### Scenario: AnEditedProfileAppliesToTheNextCheck
- **WHEN** a profile file is edited to allow a value it previously refused, and the same document is presented again
- **THEN** the document is accepted without any restart

#### Scenario: AProjectWithoutARegistryIsUnconstrained
- **WHEN** a project has no registry file
- **THEN** a valid document is presented as the core contract alone allows

### Requirement: APublishedProfileFormat

The system SHALL publish a profile format with the stable identifier `urn:structured-exchange-profile:1`
and a committed, Git-tracked JSON Schema. A profile SHALL declare its identifier, a label, and:

- the element kinds it allows, which govern graph elements and table rows;
- the relationship kinds it allows, which govern graph relationships and table relations;
- for each kind, the attributes that kind may carry, each with a type — string, number, boolean,
  reference, or enumeration — whether it is required, and whether it holds a list;
- for each enumeration, its allowed values and whether it is closed or open;
- optionally, viewpoints in the same shape a version 2 document declares them.

The format SHALL be flat: no inheritance between kinds and no references between profiles. A profile
SHALL be refused when it does not conform to its schema, when it declares a kind or an attribute of a
kind twice, when an enumeration has no values or repeats one, when a viewpoint retains a kind the profile
does not declare, when two of its viewpoints share an identifier, or when it exceeds the published
ceilings on kinds, attributes, enumeration values and viewpoints. Every refusal SHALL name a rule and
point at the offending value.

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
- a proposal removes an attribute its kind requires.

An item a proposal adds is one that carries no reference: nothing exists yet for it to leave unchanged, so
it must carry every required attribute, exactly as in a complete document. A proposal SHALL NOT be refused
for required attributes it does not mention on an item it changes, because it describes only what
changes. A changed item SHALL still state its kind, so that its attributes can be checked. Structural
heading rows SHALL NOT be held to kinds or attributes.

Each refusal SHALL name the rule, point at the offending value, and state what the profile allows at that
point — for a kind, the kinds declared in that vocabulary; for an attribute, the attributes the kind
declares; for a closed enumeration, its allowed values. Nothing SHALL be presented when a document is
refused, and nothing SHALL be corrected on the producer's behalf.

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

#### Scenario: ACoreRefusalSaysItIsNotTheProfile
- **WHEN** a document breaks the core contract in a project that registers profiles
- **THEN** the refusal says it comes from the structured-exchange contract and not from the project's profile

#### Scenario: ASequenceIsNotHeldToAProfile
- **WHEN** a sequence document names a registered profile
- **THEN** it is validated by the core contract alone

### Requirement: AnOpenEnumerationReportsRatherThanRefuses

A value outside an open enumeration SHALL NOT cause a refusal. The agent's result SHALL list each such
value with a pointer to it and the values the enumeration declares, so the agent can tell a deliberate
new value from a typo, and the presentation SHALL count them.

#### Scenario: AValueOutsideAnOpenEnumerationIsAcceptedAndReported
- **WHEN** an open enumeration attribute carries a value the profile does not list
- **THEN** the document is presented, and the agent's result points at the value and lists the declared ones

### Requirement: AProjectWithADefaultAdmitsNoWayAround

In a project whose registry declares a default profile, the agent SHALL NOT be able to step around the
model by what a document declares. A document naming a profile the registry does not register SHALL be
refused, listing the registered profiles, and a version 1 document, which cannot name a profile, SHALL be
refused saying the project's documents follow its default profile under version 2.

In a project whose registry declares no default, a document naming an unregistered profile or no profile,
and a version 1 document, SHALL be validated by the core contract alone.

#### Scenario: AnUnregisteredProfileIsRefusedUnderADefault
- **WHEN** a document names `acme/other` in a project whose registry declares a default and does not register `acme/other`
- **THEN** the document is refused, the refusal lists the registered profiles, and nothing is presented

#### Scenario: AVersionOneDocumentIsRefusedUnderADefault
- **WHEN** a version 1 document is presented in a project whose registry declares a default
- **THEN** the document is refused saying the project's documents follow its default profile under version 2

#### Scenario: WithoutADefaultAnUnregisteredProfileIsPresentedGenerically
- **WHEN** a document names an unregistered profile in a project whose registry declares no default
- **THEN** the document is validated by the core contract alone and presented generically

### Requirement: AnUnusableRegistryRefusesEverything

When a project's registry cannot be used — it is not valid JSON, does not conform to its format, lists a
file that is missing, outside the project, or not a usable profile, registers two profiles with the same
identifier, or names a default that is not registered — the agent's structured-exchange tools SHALL refuse
every document, naming the registry's rule, the file concerned and a pointer into it. They SHALL NOT fall
back to validating by the core contract alone.

#### Scenario: AMalformedProfileRefusesEveryDocument
- **WHEN** a profile file the registry lists does not conform to the profile format
- **THEN** presenting any document is refused, and the refusal names the profile file, the rule and a pointer into it

#### Scenario: AMissingProfileFileRefusesEveryDocument
- **WHEN** the registry lists a profile file that does not exist
- **THEN** presenting any document is refused naming the missing file

#### Scenario: AnUnregisteredDefaultRefusesEveryDocument
- **WHEN** the registry names a default profile it does not register
- **THEN** presenting any document is refused naming the default

#### Scenario: TwoProfilesSharingAnIdentifierRefuseEveryDocument
- **WHEN** the registry lists two profile files declaring the same identifier
- **THEN** presenting any document is refused naming both files

#### Scenario: AnUnusableRegistryNeverDegradesToTheCoreContract
- **WHEN** the registry is unusable and a document would satisfy the core contract
- **THEN** the document is still refused

### Requirement: TheFigureToolHoldsADocumentToItsProfile

The agent's figure tool SHALL hold the document it reads to its profile exactly as presenting it would,
and SHALL refuse to draw a document that strays from it, or any document while the registry is unusable,
with the same rules and pointers. Nothing SHALL be written when a request is refused.

#### Scenario: AStrayDocumentIsNotDrawn
- **WHEN** the agent requests a figure of a document whose closed enumeration value its profile does not allow
- **THEN** the request is refused with the rule and a pointer, and nothing is written

### Requirement: TheReferenceValidatorChecksProfiles

The reference validation interface SHALL, without this application's sources:

- check a profile file on its own and report its verdict;
- validate a document against a given profile file, applying the core contract and then the profile
  rules, and refusing a document that names a different profile identifier;
- print a profile as a readable listing of every kind, every attribute with its type and whether it is
  required or a list, and every enumeration value with whether the enumeration is closed or open —
  nothing elided, so the profile can be reviewed by hand against the model it was built from.

The existing process statuses SHALL keep their meaning, and a profile that is unreadable, not JSON or
does not conform SHALL be reported with a status distinct from a document that does not conform, and
documented.

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

### Requirement: TheReaderIsToldWhetherADocumentConforms

A presented document held to a profile SHALL state, in its rendering and in its accessible textual
equivalent, the profile it was checked against and that it conforms, with the number of values outside
open enumerations when there are any. The statement SHALL be established against the project's registry as
it is when the document is shown, live or restored, and SHALL say so when the registry cannot be used at
that moment or the document no longer conforms.

The statement SHALL be carried beside the document, never inside it: the document handed on for approval
SHALL remain exactly the document that was validated. A document not held to a profile SHALL carry no
statement.

#### Scenario: AConformingDocumentSaysSo
- **WHEN** a document held to `acme/requirements` is presented
- **THEN** the rendering states that it conforms to `acme/requirements`

#### Scenario: OpenEnumerationValuesAreCounted
- **WHEN** a presented document carries two values outside open enumerations
- **THEN** the rendering states that it conforms with two values outside open enumerations

#### Scenario: ARestoredDocumentIsCheckedAgainstTheProfileAsItIsNow
- **WHEN** a session is restored after the profile was changed so that a previously presented document no longer conforms
- **THEN** the restored rendering states that the document no longer conforms to the profile

#### Scenario: TheStatementDoesNotAlterTheDocument
- **WHEN** a document carrying a conformance statement is approved
- **THEN** the document handed on is byte-identical to the one that was validated

#### Scenario: ADocumentNotHeldToAProfileCarriesNoStatement
- **WHEN** a document is presented in a project without a registry
- **THEN** its rendering carries no conformance statement
