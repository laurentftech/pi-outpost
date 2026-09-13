## MODIFIED Requirements

### Requirement: OpaqueOptionalProfile

An enriched envelope MAY name one bounded, non-empty profile identifier. The profile SHALL identify
the vocabulary that owns kinds and attribute names, but the core contract SHALL treat it as an
opaque value: core validation MUST NOT infer domain semantics from it, fetch it, execute it, or reject an
otherwise valid envelope merely because the profile is unknown.

The profile identifier SHALL survive validation, presentation, approval, and recovery unaltered. A
producer or receiving authority MAY apply additional profile-specific validation outside the core
contract. A project that registers profiles locally is such an authority for the agent's documents: its
registered profiles, and its default, apply as the `structured-exchange-profiles` capability specifies,
matched by exact identifier and never retrieved. In a project without a registry, or whose registry
declares no default, an unknown profile SHALL be presented generically.

#### Scenario: UnknownProfileUsesGenericPresentation
- **WHEN** a valid enriched envelope names a profile the application does not know, in a project whose registry declares no default
- **THEN** the application presents it generically and preserves the profile identifier unchanged

#### Scenario: ProfileDoesNotSupplyExecutableBehavior
- **WHEN** a profile identifier resembles a URL, module name, or executable instruction
- **THEN** the application treats it only as inert text and does not retrieve or execute it

#### Scenario: ProfileIsOptional
- **WHEN** a valid enriched envelope carries attributes but names no profile, in a project whose registry declares no default
- **THEN** core validation accepts the attributes and the application presents their names and values generically

#### Scenario: CoreValidationIgnoresRegisteredProfiles
- **WHEN** a document that strays from a profile registered in the project is checked by core validation alone
- **THEN** core validation accepts it, and only the project's profile check refuses it
