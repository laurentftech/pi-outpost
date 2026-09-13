## MODIFIED Requirements

### Requirement: AProjectDeclaresItsProfilesLocally

A project MAY declare structured-exchange profiles with a registry file at
`.pi-outpost/structured-exchange.json` in the project directory. The registry SHALL list the profile
files it registers, by paths relative to the project, and MAY name one registered profile as the
project's default. The registry MAY also list rules files, by paths relative to the project; each rules
file applies to the registered profile it names.

Every registry, profile and rules file SHALL be read from inside the project directory. A listed path that
resolves outside the project, including through a symbolic link, SHALL make the registry unusable.
Nothing SHALL be retrieved over the network, and a profile identifier SHALL be matched against the
registered profiles by exact string equality, never resolved, fetched or executed.

A document's profile, and its rules, SHALL be looked up in the registry as they are on disk when the
document is checked, so that editing a profile or a rules file takes effect on the next check without
restarting anything.

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

#### Scenario: RegisteredRulesApplyToTheirProfile
- **WHEN** the registry lists a rules file naming `acme/requirements`, and a document held to `acme/requirements` violates one of its rules
- **THEN** the document is checked against that rule

#### Scenario: AnEditedRulesFileAppliesToTheNextCheck
- **WHEN** a rules file is edited to remove a rule a document violated, and the same document is presented again
- **THEN** the document is no longer held to that rule, without any restart

### Requirement: AnUnusableRegistryRefusesEverything

When a project's registry cannot be used — it is not valid JSON, does not conform to its format, lists a
file that is missing, outside the project, or not a usable profile or rules file, registers two profiles with
the same identifier, names a default that is not registered, lists a rules file naming a profile that is not
registered or inconsistent with that profile's vocabulary, or two rules files declaring rules with the same
identifier for one profile — the agent's structured-exchange tools SHALL refuse every document, naming the
registry's rule, the file concerned and a pointer into it. They SHALL NOT fall back to validating by the core
contract alone, nor by the profile without its rules.

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

#### Scenario: ARulesFileInconsistentWithItsProfileRefusesEveryDocument
- **WHEN** a rules file the registry lists names a value its profile's enumeration does not list
- **THEN** presenting any document is refused, naming the rules file, the rule and a pointer into it

#### Scenario: ARulesFileForAnUnregisteredProfileRefusesEveryDocument
- **WHEN** a rules file the registry lists names a profile the registry does not register
- **THEN** presenting any document is refused naming the rules file

### Requirement: TheReaderIsToldWhetherADocumentConforms

A presented document held to a profile SHALL state, in its rendering and in its accessible textual
equivalent, the profile it was checked against and that it conforms, with the number of values outside
open enumerations and the number of findings to check — violated `report` rules and rules not verifiable
here — when there are any. The statement SHALL be established against the project's registry as it is when
the document is shown, live or restored, and SHALL say so when the registry cannot be used at that moment or
the document no longer conforms.

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

#### Scenario: ARestoredDocumentIsCheckedAgainstTheProfileAsItIsNow
- **WHEN** a session is restored after the profile was changed so that a previously presented document no longer conforms
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
  required or a list, and every enumeration value with whether the enumeration is closed or open —
  nothing elided, so the profile can be reviewed by hand against the model it was built from — and, when
  given a registry, every rule with its identifier, level, source, statement and conditions, so each
  statement can be read beside what the rule checks.

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

### Requirement: AProjectWithADefaultAdmitsNoWayAround

In a project whose registry declares a default profile, the agent SHALL NOT be able to step around the
model by what a document declares. A document naming a profile the registry does not register SHALL be
refused, listing the registered profiles, and a version 1 document, which cannot name a profile, SHALL be
refused saying the project's documents follow its default profile under version 2.

In a project whose registry declares no default, a document naming an unregistered profile or no profile,
and a version 1 document, SHALL be validated by the core contract alone.

A document naming a profile identifier the contract reserves — `urn:structured-exchange-conformity-report:1`,
which a conformity report names — SHALL be validated by the core contract alone in every project, whatever
its registry's default: the identifier states what the document is, and no project's model governs it.

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
does not declare, when two of its viewpoints share an identifier, when its identifier is one the contract
reserves, or when it exceeds the published ceilings on kinds, attributes, enumeration values and
viewpoints. Every refusal SHALL name a rule and point at the offending value.

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
