# structured-exchange-profile-rules Specification

## Purpose
Lets a project write the rules its specifications are reviewed against — which attribute values fit
together on a requirement and across a traceability link — once, in its own language, and have the same
rules checked in the agent's loop and by the reference validator outside this application.

## Requirements

### Requirement: RulesAreWrittenForAProfile

The system SHALL publish a rules format with the stable identifier `urn:structured-exchange-rules:1` and a
committed, Git-tracked JSON Schema. A rules file SHALL name the identifier of the profile it applies to and
list its rules. Each rule SHALL carry a stable identifier, a statement in natural language, a level —
`refuse` or `report` — and MAY carry a source naming where it comes from.

A rule SHALL take one of two forms:

- an **item rule** names an element kind, a set of conditions that select the items it applies to, and
  either a set of conditions those items must meet or the statement that such items are forbidden;
- a **link rule** names a relationship kind, conditions on its source, its target or both that select the
  relationships it applies to, and either conditions the source or target must then meet or the statement
  that such relationships are forbidden.

A condition SHALL name one attribute and the values it may take, and holds when the attribute carries one of
them; the conditions of one set SHALL all hold. A rule MAY have no selecting conditions, in which case it
applies to every item or relationship of its kind.

A rules file SHALL be refused, with a rule and a pointer, when it does not conform to its schema, when two of
its rules share an identifier, when it names a kind the profile does not declare in the vocabulary the rule
uses, when a condition names an attribute the kind does not declare or an attribute that holds a list or a
reference, when a condition on an enumeration names a value the enumeration does not list, or when a value's
type does not match the attribute's.

#### Scenario: ALinkRuleForbidsARelationship
- **WHEN** a rules file for `acme/requirements` declares that a `satisfies` relationship whose source has `category` `derived` is forbidden, at level `refuse`
- **THEN** the rules file is usable and the rule applies to documents held to that profile

#### Scenario: ALinkRuleConstrainsTheOtherEnd
- **WHEN** a rules file declares that a `satisfies` relationship whose target has `safety` `yes` requires its source to have `safety` `yes`
- **THEN** the rules file is usable and the rule applies to documents held to that profile

#### Scenario: AnItemRuleConstrainsAttributesTogether
- **WHEN** a rules file declares that a `requirement` with `category` `derived` must have `verification` `analysis` or `review`
- **THEN** the rules file is usable and the rule applies to documents held to that profile

#### Scenario: ARuleNamingAValueTheProfileLacksIsRefused
- **WHEN** a rule's condition names the value `derivee` for an enumeration whose values are `derived`, `refined` and `direct`
- **THEN** the rules file is refused with the rule and a pointer to that value

#### Scenario: ARuleOnAnUndeclaredAttributeIsRefused
- **WHEN** a rule's condition names an attribute its kind does not declare
- **THEN** the rules file is refused with the rule and a pointer to the attribute

#### Scenario: TwoRulesSharingAnIdentifierAreRefused
- **WHEN** two rules of one file share an identifier
- **THEN** the rules file is refused with a pointer to the second

### Requirement: ADocumentIsHeldToItsProfilesRules

A document held to a profile SHALL be checked against the rules registered for that profile after it
satisfies the profile's vocabulary. An item rule SHALL apply to each subject item of its kind whose attributes
meet its selecting conditions; a link rule SHALL apply to each relationship of its kind that has a subject at
one end at least, and whose ends meet its selecting conditions.

A rule that applies and whose required conditions do not hold, or that forbids what it applies to, is
**violated**. A required condition on an attribute the item does not carry SHALL not hold.

A rule SHALL be **not verifiable** for a relationship when an end it conditions is outside the document, or
is an item of the document that is not a subject and does not carry the attribute the condition names. Such a
rule SHALL be neither satisfied nor violated.

Every item of a document SHALL be a subject unless the document is checked with a stated set of subjects, as
batch validation does.

#### Scenario: ADerivedRequirementSatisfyingUpstreamIsAViolation
- **WHEN** a table holds a requirement with `category` `derived` and a `satisfies` relation from it to another requirement, under the rule forbidding that
- **THEN** the rule is violated for that relation

#### Scenario: ASafetyRequirementSatisfiedByANonSafetyOneIsAViolation
- **WHEN** a `satisfies` relation goes to a requirement with `safety` `yes` from a requirement with `safety` `no`, under the rule requiring the source to be tagged safety
- **THEN** the rule is violated for that relation

#### Scenario: AConformingLinkSatisfiesTheRule
- **WHEN** both ends of such a relation have `safety` `yes`
- **THEN** the rule is satisfied

#### Scenario: AnEndOutsideTheDocumentIsNotVerifiable
- **WHEN** a `satisfies` relation's target is a reference to an object outside the document, under a rule conditioning its target
- **THEN** the rule is not verifiable for that relation, and neither satisfied nor violated

#### Scenario: ANeighbourWithoutTheAttributeIsNotVerifiable
- **WHEN** the other end of a relation is a non-subject item of the document that does not carry the attribute the rule conditions
- **THEN** the rule is not verifiable for that relation

#### Scenario: AnItemRuleSelectsByItsConditions
- **WHEN** an item rule applies to requirements with `category` `derived`, and a requirement has `category` `direct`
- **THEN** the rule does not apply to that requirement

#### Scenario: AMissingRequiredAttributeViolatesTheRule
- **WHEN** an item rule requires `verification` to be `analysis` or `review` and an applicable subject requirement carries no `verification`
- **THEN** the rule is violated for that requirement

### Requirement: RulesRefuseOrReportInTheAgentsTools

In the agent's structured-exchange tools, a violated `refuse` rule SHALL refuse the document, naming the
rule's identifier, its statement and source, and pointing at the item or relationship. A violated `report`
rule, and a rule not verifiable here, SHALL NOT refuse the document; the agent's result SHALL list each with
the same identification, marked as a finding to check.

Rule refusals SHALL be reported only for a document that satisfies the profile's vocabulary, and a refusal
SHALL be distinguishable from a vocabulary refusal by its rule namespace.

#### Scenario: ARefuseRuleRefusesTheDocument
- **WHEN** the agent presents a table whose derived requirement satisfies an upstream requirement, under a `refuse` rule forbidding it
- **THEN** the document is refused naming the rule's identifier and statement, and nothing is presented

#### Scenario: AReportRuleIsListedButDoesNotRefuse
- **WHEN** the agent presents a document violating a `report` rule
- **THEN** the document is presented, and the agent's result lists the rule's identifier and statement as a finding to check

#### Scenario: VocabularyIsCheckedBeforeRules
- **WHEN** a document both uses a value the profile does not allow and violates a rule
- **THEN** the refusal reports the vocabulary violation, and the rule is applied once it is fixed
