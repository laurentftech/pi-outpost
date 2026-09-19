## ADDED Requirements

### Requirement: EachProjectKeepsItsOwnDirectoryWhenSettingsApply

The sandbox root and writable root SHALL belong to the server's own project, and SHALL be editable from Settings only from that project; moving them SHALL leave every other open project in its own directory. A writable root SHALL be kept, and ignored, while write is off, so that write can be turned off from a project that cannot edit the roots. Settings applied from any other project SHALL take only the agent's permissions — write and bash — and SHALL leave the roots as they are. A project rebuilt after Settings apply SHALL be confined to its own directory: the server's sandbox root for the server's own project, its own directory for any other.

#### Scenario: ApplyFromASecondProjectKeepsItsDirectory
- **GIVEN** two open projects, and Settings showing the server's sandbox
- **WHEN** Settings is applied from the second project with the sandbox it was shown
- **THEN** the second project's file browser and tools are still confined to its own directory, not the first project's

#### Scenario: APermissionChangedFromASecondProjectApplies
- **GIVEN** two open projects and a read-only sandbox
- **WHEN** write is allowed from the second project, together with a root naming the first project
- **THEN** the second project can write in its own directory, and its root is not moved

#### Scenario: WriteCanBeTurnedOffWhileAWritableRootIsKept
- **GIVEN** two open projects and a server sandbox with a writable root
- **WHEN** write is turned off from the second project, then on again
- **THEN** both are accepted: nothing is writable in that project while write is off, the writable root is kept, and the project's own directory is writable again once write is back

#### Scenario: TheServersProjectAloneStillMovesItsRoot
- **GIVEN** the server's own project, open alone
- **WHEN** Settings moves the sandbox root to one of its subdirectories
- **THEN** the file browser and tools are confined to that subdirectory

#### Scenario: TheServersProjectMovesItsRootWhileAnotherIsOpen
- **GIVEN** the server's own project, and a second project open on the same server
- **WHEN** Settings moves the sandbox root from the server's own project to one of its subdirectories
- **THEN** that project is confined to the subdirectory, and the second project is still confined to its own directory

### Requirement: AnUnchangedSandboxIsNotAChange

A sandbox sent back with the same root, writable root and permissions as the one in force SHALL be neither written to the configuration file nor reapplied, and an update carrying nothing else SHALL be acknowledged without replacing the session. The Settings panel SHALL offer Apply for the sandbox only once one of its fields differs from the one in force.

#### Scenario: ApplyIsOfferedOnlyAfterAChange
- **WHEN** the Settings panel is opened and nothing in the sandbox section is changed
- **THEN** Apply is not offered, and nothing is sent; it is offered once a field differs, and withdrawn when the field is set back

### Requirement: SettingsShowTheAgentsPermissionsWithSeveralProjects

When the roots cannot be edited from the project being looked at — or when the standalone app, which offers several projects, has more than one open — the Settings section SHALL be titled for the agent's permissions, SHALL name the directory this project is confined to, and SHALL offer no root or writable root to edit. A server that does not say whether the roots are editable SHALL be treated as allowing it. An embedded widget bound to one project SHALL keep the root controls its embed policy gives it, whatever else the server holds.

#### Scenario: SeveralProjectsShowPermissionsOnly
- **GIVEN** several projects open in the standalone app
- **WHEN** Settings is opened on one of them
- **THEN** the section reads "Agent permissions", names that project's own directory, and has no root or writable root control, while write and bash remain editable

#### Scenario: ASingleProjectKeepsTheFullSection
- **GIVEN** a server that does not report whether the roots are editable
- **WHEN** Settings is opened
- **THEN** the section reads "Sandbox" with the root and writable root controls

#### Scenario: AWidgetBoundToOneProjectKeepsItsRoot
- **GIVEN** an embedded widget bound to the server's own project, whose server also holds another project
- **WHEN** Settings is opened
- **THEN** the section reads "Sandbox" with the root control, as the embed policy offers
