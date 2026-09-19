# persistent-runtime-settings Specification

## Purpose

Makes runtime settings changed from the web interface durable across server and agent-session restarts.

## Requirements

### Requirement: Persist editable runtime settings
The system SHALL persist an accepted settings update to the configuration file it loaded before replacing the agent session.

#### Scenario: Restart preserves selected skill path
- **WHEN** the user adds a mounted server skills directory and applies settings
- **THEN** a restarted server loads that directory in addition to built-in skills

#### Scenario: Persistence failure keeps the live configuration
- **WHEN** the loaded configuration file cannot be written
- **THEN** the system reports the persistence failure and does not replace the session or claim the settings were applied

### Requirement: Protect configuration-file skill paths
The system SHALL keep the skill paths declared in the configuration file out of reach of the interface: it SHALL load them, SHALL NOT rewrite or remove them when it persists a settings update, and SHALL hold the paths added through Settings under a separate key.

#### Scenario: A removed user path leaves the deployment's paths intact
- **GIVEN** the configuration file declares a skill path
- **WHEN** the user removes their own skill paths and applies settings
- **THEN** the declared path is still in the configuration file and its skills are still loaded

#### Scenario: The interface offers only the user's own paths
- **WHEN** the settings menu shows skill paths
- **THEN** it lists the paths added through Settings and offers removal for those only

### Requirement: Reload resources after settings apply
The system SHALL replace the agent session after it persists a changed skill path, extension path, or sandbox setting.

#### Scenario: New skill is visible after apply
- **WHEN** the user applies a newly selected skill directory
- **THEN** the replacement session's resource inventory includes the skills discovered from that directory

#### Scenario: New extension is loaded after apply
- **WHEN** the user applies a newly selected extension directory
- **THEN** the replacement session has loaded the extensions discovered in that directory, without a server restart

#### Scenario: New sandbox governs the replacement session
- **WHEN** the user changes the sandbox root through Settings and applies it
- **THEN** the file browser and the replacement session's tools are both confined to the new root
- **AND** the old root is no longer visible to those tools unless it is independently allowed

### Requirement: Protect configuration-file extension paths

The system SHALL keep the extension paths declared in the configuration file out of
reach of the interface: it SHALL load them, SHALL NOT rewrite or remove them when it
persists a settings update, and SHALL hold the paths added through Settings under a
separate key.

An accepted extension-path update SHALL be persisted before the agent session is
replaced, on the same terms as every other editable setting: a write that fails leaves
the live configuration, the loaded extensions and the session in front of the user
exactly as they were.

#### Scenario: A removed user extension path leaves the deployment's paths intact
- **GIVEN** the configuration file declares an extension path
- **WHEN** the user removes their own extension paths and applies settings
- **THEN** the declared path is still in the configuration file and its extensions are still loaded

#### Scenario: Restart preserves a selected extension path
- **WHEN** the user adds a server extensions directory and applies settings
- **THEN** a restarted server loads the extensions discovered in that directory

#### Scenario: The interface offers only the user's own extension paths
- **WHEN** the settings menu shows extension paths
- **THEN** it lists the paths added through Settings and offers removal for those only

### Requirement: Refuse a locked extension change at the server

The system SHALL enforce an extension-path lock where the decision is made, not only
where the control is drawn: a request that would add or remove an extension path on a
locked server SHALL be refused, and nothing SHALL be persisted or rebuilt.

#### Scenario: A locked server refuses a hand-sent request
- **GIVEN** a configuration that locks extension paths
- **WHEN** a settings update carrying extension paths arrives from a client that drew no control for them
- **THEN** the update is refused, the configuration file is unchanged, and the session is not replaced

#### Scenario: A locked extension path does not block the rest of an apply
- **GIVEN** a configuration that locks extension paths
- **WHEN** a settings update carries only sandbox and skill changes
- **THEN** it is applied normally

### Requirement: Persist collection skill selections

The system SHALL persist, for each repository enrolled as a skill collection, the repository and
the set of its skills that are on, under a key of its own, apart from the configuration file's
skill paths and from the user skill paths. A restart SHALL load the same skills that were on
before it, and no others from that repository. Persisting a selection SHALL NOT rewrite or remove a
skill path declared in the configuration file.

A changed selection SHALL be treated like a changed skill path: it SHALL be persisted and SHALL
replace the agent session, and a persistence failure SHALL keep the live configuration unchanged.
Removing a repository SHALL remove its selection from the persisted settings.

#### Scenario: Restart preserves a collection selection
- **GIVEN** a collection with two skills on
- **WHEN** the server restarts
- **THEN** those two skills are loaded and no other skill from that repository is

#### Scenario: A selection change leaves configuration-file paths intact
- **GIVEN** the configuration file declares a skill path
- **WHEN** the user changes a collection selection and applies it
- **THEN** the persisted configuration still declares that skill path unchanged

#### Scenario: A newly enabled collection skill is visible after apply
- **WHEN** the user turns a collection skill on and the change is applied
- **THEN** the replacement session lists that skill

#### Scenario: A failed write keeps the live selection
- **WHEN** persisting a changed selection fails
- **THEN** the live configuration and the active session keep the previous selection and the client is told the change failed

#### Scenario: Removal clears the persisted selection
- **WHEN** a collection repository is removed
- **THEN** the persisted settings no longer name that repository or any of its skills

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
