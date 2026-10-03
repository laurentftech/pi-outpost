# Spec Delta

## MODIFIED Requirements

### Requirement: AProjectDeclaresItsProfilesLocally

A project MAY declare structured-exchange profiles with a registry file at
`.pi-outpost/structured-exchange.json` in the project directory. A version 1 registry SHALL list the profile
files it registers, by paths relative to the project; a version 2 registry MAY list none, for a project that
declares only its appearance. The registry MAY name one registered profile as the project's default. The
registry MAY also list rules files, by paths relative to the project; each rules file applies to the
registered profile it names. A version 2 registry MAY also declare the project's kind colours, as the
`structured-exchange-appearance` capability specifies.

Every registry, profile and rules file SHALL be read from inside the project directory. A listed path that
resolves outside the project, including through a symbolic link, SHALL make the registry unusable.
Nothing SHALL be retrieved over the network, and a profile identifier SHALL be matched against the
registered profiles by exact string equality, never resolved, fetched or executed.

A document's profile, and its rules, SHALL be looked up in the registry as they are on disk when the
document is checked, so that editing a profile or a rules file takes effect on the next check without
restarting anything.

A project without a registry file SHALL be unconstrained: documents are validated by the core contract
alone, as they were before profiles existed. So SHALL a project whose registry registers no profile.

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

#### Scenario: ARegistryWithOnlyAnAppearanceConstrainsNothing
- **WHEN** a version 2 registry declares an appearance and no profile
- **THEN** it is valid, and a valid document is presented as the core contract alone allows

#### Scenario: ADefaultNeedsARegisteredProfile
- **WHEN** a version 2 registry names a default and registers no profile
- **THEN** the registry is unusable, naming the default
