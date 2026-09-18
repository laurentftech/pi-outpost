## MODIFIED Requirements

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

A condition of an item rule SHALL be read against its element kind. A condition of a link rule on the source
or the target SHALL be read against the element kinds the relationship kind allows at that end, or against every
element kind of the profile when that end is undeclared.

A rules file SHALL be refused, with a rule and a pointer, when it does not conform to its schema, when two of
its rules share an identifier, when it names a kind the profile does not declare in the vocabulary the rule
uses, when a condition names an attribute that no kind it is read against declares, or an attribute that holds a
list or a reference, when a condition on an enumeration names a value the enumeration does not list, or when a
value's type does not match the attribute's.

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

#### Scenario: ALinkRuleConditionIsReadOnTheDeclaredEnds
- **WHEN** the profile allows only `requirement` at the source of `satisfies`, only `test` declares `bench`, and a link rule conditions the source's `bench`
- **THEN** the rules file is refused with the rule and a pointer to `bench`, naming the kinds allowed at the source

#### Scenario: AnUndeclaredEndReadsEveryElementKind
- **WHEN** the profile declares no ends for `traces`, only `test` declares `bench`, and a link rule conditions the source's `bench`
- **THEN** the rules file is usable
