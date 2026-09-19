# structured-exchange-project-setup Specification

## Purpose
Helps a project set up the model and the review rules its structured-exchange documents are held to — a skill
that teaches the agent to write the registry, profiles and rules files, and generated views on which a person
confirms that what the files check is what the project meant.

## Requirements

### Requirement: ASkillTeachesSettingUpAProject

The product SHALL ship a second skill, `structured-exchange-project`, loaded from the same place and in the same
way as the bundled `structured-exchange` skill, and turned off with it when skills are disabled. Its description
SHALL name the registry, profiles and rules it is for, and say to read it before writing or changing any of
them, or when the project's registry cannot be used.

The skill SHALL teach:

- the order of the work: a profile, checked and listed; rules, started from a complete example; the registry
  listing both; then the generated rules register and rule patterns shown to a person, who confirms that each
  statement says what its conditions check;
- that the check after each file is the agent tool presenting the project model, and what to do with each kind
  of issue it returns;
- that several values in one condition mean any one of them, and several attributes in one set mean all of
  them;
- that an item lacking an attribute named in `when` is not selected by the rule, and escapes it;
- that `from` and `to` belong only to link rules, and that a relationship kind's declared ends decide which
  element kinds a link rule's conditions are read on;
- when a rule should refuse and when it should only report;
- never to invent a kind, an attribute or a value the source model does not have, and to ask the user instead.

The `structured-exchange` skill SHALL keep document authoring and refusal handling, and SHALL point to
`structured-exchange-project` for setting up a project's registry, profiles and rules.

#### Scenario: BothBundledSkillsLoad
- **WHEN** the server hands the bundled skills to the agent's skill loader
- **THEN** both `structured-exchange` and `structured-exchange-project` load without diagnostics

#### Scenario: TheSetupSkillIsTurnedOffWithSkills
- **WHEN** skills are disabled
- **THEN** neither bundled skill is loaded

#### Scenario: TheSetupSkillIsSelectedForTheProjectsFiles
- **WHEN** the setup skill's description is read
- **THEN** it names the registry, profiles and rules, and says to read it before writing or changing them

#### Scenario: TheAuthoringSkillPointsToTheSetupSkill
- **WHEN** the `structured-exchange` skill is read
- **THEN** it names `structured-exchange-project` as the skill for setting up a project's registry, profiles and rules

#### Scenario: TheSetupSkillTeachesWhatPassesSilently
- **WHEN** the setup skill is read
- **THEN** it states that values in one condition are alternatives, that attributes in one set must all hold, and that an item lacking an attribute named in `when` escapes the rule

### Requirement: TheSetupFormatsCarryExamples

The published profile and rules schemas SHALL carry examples: the profile schema a profile whose relationship
kind declares its ends, and the rules schema an item rule and a link rule. Every example SHALL be valid against
its schema, and the rules example SHALL be valid against the profile example. Every field of a rule SHALL carry a
description.

#### Scenario: TheExamplesAreValid
- **WHEN** the examples of the published profile and rules schemas are checked
- **THEN** each is valid against its schema, and the rules example is usable with the profile example

#### Scenario: EveryRuleFieldIsDescribed
- **WHEN** the published rules schema is read
- **THEN** a rule's identifier, statement, source, level, kind, `when` and `then` each carry a description

### Requirement: TheRulesRegisterIsGenerated

The system SHALL generate, from a registered profile and the rules registered for it, a rules register: a
version 2 structured-exchange table naming the profile identifier `urn:structured-exchange-rules-register:1`,
which the contract reserves. It SHALL be generated from the files alone, never written by the model, and the same
files SHALL produce the same document.

Its columns SHALL be the rule's identifier, level, what it applies to, `when`, `then`, statement, source, and the
attributes without which an item is not selected. The register SHALL open with a heading naming the profile's
identifier and label, and SHALL hold beneath it one chapter per kind at least one rule
targets — element kinds first, then relationship kinds, each in the profile's declaration order — and in each
chapter one row per rule, in the order of the registry's rules files and of the rules within them.

`when` and `then` SHALL read as they are checked: each condition as the attribute and the values any one of which
it accepts, the conditions of one set joined as all holding, a link rule's conditions labelled as on the source or
the target, a rule without selecting conditions as applying always, and a forbidding rule as forbidden. The last
column SHALL name every attribute of `when`, labelled by end for a link rule.

The register SHALL record the profile file and each rules file it was generated from as artifacts carrying their
`sha256` digests. A profile with no rules SHALL produce a register that says so. A register that would exceed the
contract's ceilings SHALL NOT be produced, and the refusal SHALL say so.

#### Scenario: RulesAreGroupedByTheKindTheyTarget
- **WHEN** a profile has two rules on `requirement` and one on the `satisfies` relationship
- **THEN** the register holds a `requirement` chapter with the two rules, then a `satisfies` chapter with the third

#### Scenario: ConditionsReadAsTheyAreChecked
- **WHEN** a rule's `when` names `category` with `derived` and `refined`, and `safety` with `yes`
- **THEN** its `when` cell reads `category` as either value, and both conditions as having to hold

#### Scenario: TheAttributesARuleSelectsOnAreNamed
- **WHEN** a link rule's `when` conditions the target's `safety`
- **THEN** its last cell names `safety` on the target

#### Scenario: AForbiddingRuleReadsAsForbidden
- **WHEN** a link rule's `then` is `forbidden`
- **THEN** its `then` cell reads forbidden

#### Scenario: TheRegisterRecordsItsSources
- **WHEN** a register is generated
- **THEN** it carries the profile file and each rules file as artifacts with their digests

#### Scenario: TheRegisterIsReproducible
- **WHEN** a register is generated twice from unchanged files
- **THEN** the two documents are identical

#### Scenario: AProfileWithoutRulesSaysSo
- **WHEN** a register is generated for a profile no rules file names
- **THEN** the register holds no rule and says that the profile has no rules

#### Scenario: TheRegisterIsAValidTable
- **WHEN** a register is generated within the ceilings
- **THEN** it is accepted by the core contract as a version 2 table

### Requirement: TheRulePatternsAreGenerated

The system SHALL generate, from a registered profile and the rules registered for it, rule patterns: a version 2
structured-exchange graph naming the profile identifier `urn:structured-exchange-rule-patterns:1`, which the
contract reserves. It SHALL be generated from the files alone, never drawn by the model, and the same files SHALL
produce the same document.

It SHALL hold one container per rule, in the order of the registry's rules files and of the rules within them,
labelled with the rule's level, identifier and statement. A statement too long for a container's label SHALL be
shortened with an ellipsis there, since the rules register holds it whole. In each container:

- a link rule SHALL be drawn as one element for its source and one for its target, joined by a relationship of the
  rule's relationship kind. Each end SHALL be labelled with the element kinds its relationship kind allows there —
  or any element kind when that end is undeclared — followed by the conditions that select it (`when`) and the
  conditions it must meet (`must have`). An end's kind SHALL say whether the rule selects on it, requires of it, or
  leaves it free. A forbidding rule's relationship SHALL be marked forbidden in its kind and its label;
- an item rule SHALL be drawn as one element labelled with its element kind, the conditions that select it and the
  conditions it must meet, or forbidden, its kind saying which.

A condition SHALL read as the attribute and the values any one of which it accepts; the conditions of one set SHALL
be listed together, all holding.

The patterns SHALL record the profile file and each rules file as artifacts carrying their `sha256` digests. A
profile with no rules SHALL produce no patterns, and the refusal SHALL say so. Patterns that would exceed the
contract's ceilings — among them the number of containers — SHALL NOT be produced, and the refusal SHALL say so.

#### Scenario: ALinkRuleIsDrawnBetweenItsTypedEnds
- **WHEN** a `refuse` rule forbids a `satisfies` relationship whose source has `category` `derived`, and `satisfies` allows `requirement` at both ends
- **THEN** its container is labelled with `refuse`, the rule's identifier and statement, and holds a source labelled `requirement` with `when category = derived`, a target labelled `requirement`, and a `satisfies` relationship between them marked forbidden

#### Scenario: WhatAnEndMustHaveIsShownApartFromWhatSelectsIt
- **WHEN** a rule requires the source of `satisfies` to have `safety` `yes` when its target has `safety` `yes`
- **THEN** the source is labelled `must have safety = yes` and is of the kind for a required end, and the target is labelled `when safety = yes` and is of the kind for a selecting end

#### Scenario: AnUndeclaredEndIsShownAsAnyKind
- **WHEN** a link rule applies to a relationship kind that declares no source
- **THEN** its source is labelled as any element kind, and no element kind is guessed

#### Scenario: AnItemRuleIsOneElement
- **WHEN** an item rule on `requirement` selects `safety` `yes` and requires `status` `approved`
- **THEN** its container holds one element labelled `requirement` with `when safety = yes` and `must have status = approved`

#### Scenario: ALongStatementIsShortenedOnlyInTheLabel
- **WHEN** a rule's statement is longer than a container's label allows
- **THEN** the container's label ends with an ellipsis, and the patterns are produced

#### Scenario: AProfileWithoutRulesHasNoPatterns
- **WHEN** patterns are asked for a profile no rules file names
- **THEN** none are produced, and the refusal says the profile has no rules

#### Scenario: TooManyRulesAreRefusedNotCut
- **WHEN** patterns are asked for a profile with more rules than the contract allows containers
- **THEN** none are produced, and the refusal names the ceiling

#### Scenario: ThePatternsAreReproducible
- **WHEN** patterns are generated twice from unchanged files
- **THEN** the two documents are identical

#### Scenario: ThePatternsAreAValidGraph
- **WHEN** patterns are generated within the ceilings
- **THEN** they are accepted by the core contract as a version 2 graph, and record their sources

### Requirement: TheAgentPresentsTheProjectModel

The agent SHALL have a tool, `present_project_model`, that presents the rules register or the rule patterns of a
registered profile. It SHALL read the project's registry, profiles and rules as they are on disk when called, and
SHALL write nothing.

Most conversations never touch a project's model, so the tool SHALL be withheld from the model until one does, and
SHALL be published — for the rest of the turn in which it happens, before the next request to the model — when:

- a prompt names the registry file or a file the registry lists, or the user opens the setup skill
  (`/skill:structured-exchange-project`);
- the agent reads or writes the registry, a file it lists, or a file whose content declares the profile, rules or
  registry format;
- the agent reads the `structured-exchange-project` skill;
- a structured-exchange tool reports that the project's registry cannot be used.

Each project SHALL be its own: what publishes the tool in one project SHALL NOT publish it in another open
beside it, and the tool SHALL present the model of the project whose session called it.

Once published, it SHALL be withdrawn as the document extractors are: after one turn if it was never called, after
five turns without a call once it has been. A runtime that cannot withhold a registered tool SHALL publish it always.

When the call names no profile, the tool SHALL use the registry's default, else the only registered profile; with
several profiles and no default, or a profile the registry does not register, it SHALL present nothing and list the
registered profiles.

On success the view SHALL be presented as a structured-exchange document, and the agent's result SHALL carry the
text listing of the profile and of its rules, nothing elided, and say that a person should confirm that each
statement says what its conditions check.

The tool SHALL present nothing, as an error result, when the project has no registry — saying where the registry
goes — and when the registry cannot be used, listing every issue with its file, rule and pointer. When a rules file
does not have the format's shape, the result SHALL also give the shape of a rules file to copy — an item rule and a
link rule — since a model that invents fields reads the refusal and not the skill.

#### Scenario: TheToolIsWithheldUntilTheModelIsTouched
- **WHEN** a session starts in a project with a registry, and a prompt names none of its files
- **THEN** the request sent to the model does not carry `present_project_model`

#### Scenario: NamingAModelFilePublishesTheTool
- **WHEN** a prompt names a profile file the registry lists
- **THEN** the request carrying that prompt carries `present_project_model`

#### Scenario: UserOpeningTheSetupSkillPublishesTheTool
- **WHEN** the user's prompt opens the setup skill with `/skill:structured-exchange-project`
- **THEN** the first request of that turn carries `present_project_model`

#### Scenario: WritingAModelFilePublishesTheToolWithinTheTurn
- **WHEN** the agent writes the registry, or a file declaring the rules format, during a turn
- **THEN** the next request of that same turn carries `present_project_model`

#### Scenario: ReadingTheSetupSkillPublishesTheTool
- **WHEN** the agent reads the `structured-exchange-project` skill during a turn
- **THEN** the next request of that same turn carries `present_project_model`

#### Scenario: AnUnusableRegistryRefusalPublishesTheTool
- **WHEN** a structured-exchange tool refuses a document because the project's registry cannot be used
- **THEN** the next request of that same turn carries `present_project_model`

#### Scenario: EachProjectsModelIsItsOwn
- **WHEN** two projects are open, each with its own registry, and a prompt names a file only the first project's registry lists
- **THEN** the request carries the tool while the connection is bound to the first project, and not once it is bound to the second, which publishes it for its own file

#### Scenario: AnUncalledToolIsWithdrawn
- **WHEN** the tool was published during a turn and the agent did not call it
- **THEN** the first request of the following turn does not carry it

#### Scenario: TheAgentPresentsTheRulesRegister
- **WHEN** the agent asks for the rules register in a project whose registry has one profile with rules
- **THEN** the register is presented and rendered as a table

#### Scenario: TheAgentPresentsTheRulePatterns
- **WHEN** the agent asks for the rule patterns of a registered profile
- **THEN** the patterns are presented and rendered as a graph

#### Scenario: TheAgentReadsTheListing
- **WHEN** a view is presented
- **THEN** the agent's result holds every rule's identifier, level, statement and conditions, and asks for a person to confirm them

#### Scenario: AnUnusableRegistryIsReportedIssueByIssue
- **WHEN** the agent asks for a view while one rule names a value its profile does not list and another names an attribute its kind does not declare
- **THEN** nothing is presented, and the result names both issues with their file, rules and pointers

#### Scenario: TheRuleFormIsGivenWhenARulesFileBreaksIt
- **WHEN** the agent asks for a view while a rules file uses fields the format does not define
- **THEN** nothing is presented, and the result lists the issues followed by a rules file to copy, which is itself valid, and names the setup skill's command

#### Scenario: AProjectWithoutARegistryIsToldWhereItGoes
- **WHEN** the agent asks for a view in a project with no registry
- **THEN** nothing is presented, and the result names `.pi-outpost/structured-exchange.json`

#### Scenario: SeveralProfilesNeedOneNamed
- **WHEN** the agent asks for a view without naming a profile in a project registering two profiles and no default
- **THEN** nothing is presented, and the result lists both profiles

#### Scenario: AnEditedRulesFileIsPresentedAsItIsNow
- **WHEN** a rules file is edited between two calls
- **THEN** the second view shows the edited rules without any restart

#### Scenario: AViewIsNeverHeldToTheProjectsProfile
- **WHEN** a view is presented in a project whose registry declares a default profile
- **THEN** it is presented without refusal and carries no conformance statement

### Requirement: TheReferenceValidatorWritesTheViews

The reference validation interface SHALL, given a project registry and without this application's sources, write
the rules register and the rule patterns of a registered profile to files it is given, choosing the profile as the
agent's tool does. It SHALL write the same document the agent's tool presents from the same files. When the registry
cannot be used it SHALL write nothing and exit with the status for an unusable profile.

#### Scenario: TheValidatorWritesBothViews
- **WHEN** a producer asks the interface for the rules register and the rule patterns of a registry
- **THEN** both files are written, each a valid version 2 document

#### Scenario: TheValidatorAndTheToolAgree
- **WHEN** the interface and the agent's tool produce a view from the same files
- **THEN** the two documents are identical

#### Scenario: AnUnusableRegistryWritesNoView
- **WHEN** a producer asks for a view of a registry whose rules file is inconsistent with its profile
- **THEN** no file is written, and the status is the one for an unusable profile
