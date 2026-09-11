## MODIFIED Requirements

### Requirement: AgentResourceManager

The component layer SHALL expose a dedicated Agent resources dialog from Settings as the single interactive surface for adding and removing user skill and extension roots, for turning collection skills on and off, and for removing repositories. Settings SHALL retain the loaded and configured resource summary but SHALL open this dialog instead of presenting separate add-directory controls. The dialog SHALL present separate **Add local folder…** and **Add Git repository…** buttons. The dialog SHALL otherwise use a repository-first split layout: a searchable and filterable repository list with an attention summary on the left, and the selected repository's status, actions, skills, and extensions on the right. Non-Git and provenance-unavailable resources SHALL be reachable as non-updateable groups.

For a repository enrolled as a collection, the detail pane SHALL list the repository's catalogued skills grouped by the folder groups the inventory supplies, each skill with an on/off switch showing its supplied state — on and loaded, on and not loaded with its reason, on and missing, or off. The pane SHALL offer **All on** and **All off** for the whole repository, and the same pair for each folder group. Each folder group SHALL show how many of its skills are on and SHALL be collapsible. Switch and bulk actions SHALL stage a pending selection that the dialog shows as pending, together with the number of changes, until the user applies it — reporting it in one callback — or discards it. The pending selection SHALL belong to the repository it was made for: it MUST NOT be applied to, or displayed under, another repository, and a new inventory for the same repository SHALL NOT silently drop it. The collection preview shown before enrollment SHALL use the same grouped catalogue with every skill off.

The pane SHALL let the user find skills in a large collection: the skills that are on SHALL be listed together above the folder groups, each with its folder, its state and a way to turn it off, and the repository list SHALL show how many of a collection's skills are on; folder groups holding a skill that is on SHALL open by default while the others stay folded, a filter SHALL narrow the list to the skills that are on, and a search SHALL narrow it to skills whose name, folder path or description matches. While a filter or search is active, each folder SHALL show only its matching skills, and its **All on** / **All off** SHALL act on those skills alone.

The detail pane SHALL offer **Remove repository** for a repository whose resources are all user-registered. Requesting it SHALL first show a confirmation that names the repository and the path whose files will be deleted, or states that the files will be kept when the repository is not managed by pi-outpost, and says that the deletion cannot be undone; the removal callback SHALL be invoked only after that explicit confirmation. A repository that supplies a configuration-file path SHALL offer no removal action and SHALL say why.

Repository identities are server-issued and do not outlive the server that issued them. The dialog SHALL treat an identity it can no longer resolve — after a reconnect, a restart, or an inventory that no longer contains it — as a stale selection, and SHALL fall back to a visible group rather than showing an empty detail pane or an operation aimed at nothing.

The component SHALL render only supplied inventory and operation state and SHALL report repository selection/enrollment, resource-root removal, skill selection, repository removal, refresh, update, confirmation, selection, search, and filtering requests through callbacks. It SHALL disable or withhold update actions when the supplied state is blocked, explain how local changes can be resolved externally, and require a separate explicit confirmation step for repositories marked as containing extensions. Results from an earlier selection or operation MUST NOT be presented as belonging to a newly selected repository.

#### Scenario: Open repository-first resource manager
- **GIVEN** Settings is supplied with resource repository and inventory state
- **WHEN** the user opens Agent resources
- **THEN** a split dialog lists repository groups and shows the selected group's status, skills, and extensions

#### Scenario: Settings delegates resource changes to the dialog
- **GIVEN** Settings is supplied with loaded resources and user resource paths
- **WHEN** the user asks to manage agent resources
- **THEN** it opens the Agent resources dialog
- **AND** Settings itself offers no separate add-directory or remove-path controls

#### Scenario: Add repository previews roots before applying
- **GIVEN** the Agent resources dialog is open
- **WHEN** the user selects Add Git repository and submits a repository address and local clone folder
- **THEN** the dialog presents the grouped skill catalogue with every skill off, and the discovered extension roots for selection
- **AND** does not request a settings change until the user confirms the preview

#### Scenario: Git repository form suggests but does not fix the destination
- **GIVEN** the user has entered a repository address
- **WHEN** the Add Git repository form derives its local folder
- **THEN** it suggests a collision-resistant path under managed resource storage
- **AND** the user can edit that path or select its parent with the server-directory picker before cloning

#### Scenario: Add local folder remains available
- **GIVEN** the Agent resources dialog is open
- **WHEN** the user selects Add local folder
- **THEN** the dialog opens the server-directory picker and lets the user choose whether the folder contains skills or extensions

#### Scenario: Search and attention filters preserve repository context
- **GIVEN** the dialog contains several repositories with different resource kinds and states, including a repository that supplies both skills and extensions
- **WHEN** the user searches or filters by resource kind or attention state
- **THEN** only groups containing a match remain and the detail pane either retains a matching selection or selects a visible group
- **AND** each visible group and its detail pane contain only resources matching the active resource-kind filter, while search and attention filters determine group visibility
- **AND** each visible group count reflects that kind-filtered resource subset rather than the repository's unfiltered total

#### Scenario: Dirty repository directs resolution outside the app
- **GIVEN** the selected repository is reported as dirty
- **WHEN** its details are displayed
- **THEN** no update action is enabled and the dialog exposes its path and guidance to review local changes externally
- **AND** it offers no commit, stash, discard, rebase, or merge control

#### Scenario: Update is offered only when there is one
- **GIVEN** a selected repository that has not been checked, is up to date, or cannot be fast-forwarded
- **WHEN** its details are displayed
- **THEN** Check is offered and no Update repository action is shown
- **AND** once the repository is reported as updateable, Update repository is shown, and it stays visible, disabled, while the update runs

#### Scenario: Extension confirmation precedes update callback
- **GIVEN** an updateable selected repository is marked as supplying extensions
- **WHEN** the user requests an update
- **THEN** the dialog first explains the executable-code risk
- **AND** invokes the update callback only after explicit confirmation

#### Scenario: Selection changes during an operation
- **GIVEN** a check or update is pending for one repository
- **WHEN** the user selects another repository before it completes
- **THEN** the pending state and result remain correlated with the original repository and are not rendered as the new repository's result

#### Scenario: A selected repository the server no longer knows
- **GIVEN** a repository is selected in the dialog
- **WHEN** a new inventory arrives without that repository, as after a server restart
- **THEN** the dialog selects a visible group and offers no action for the identity that is gone

#### Scenario: Provenance-unavailable resources stay visible
- **GIVEN** inventory entries cannot be attributed to a Git repository
- **WHEN** the Agent resources dialog opens
- **THEN** those entries appear in an explicitly non-updateable group with the supplied reason

#### Scenario: Collection skills are grouped by folder with switches
- **GIVEN** a collection repository whose inventory supplies skills in the folder groups `dev-skills` and `agent-skills`
- **WHEN** the repository is selected
- **THEN** its skills appear under those two groups, each with a switch showing whether it is on, and each group shows how many of its skills are on

#### Scenario: Skill states are distinguished
- **GIVEN** a collection whose inventory supplies skills that are on and loaded, on and not loaded with a reason, on and missing, and off
- **WHEN** the repository is selected
- **THEN** each of those four states is rendered distinctly, with the supplied reason for the one not loaded

#### Scenario: All on and all off stage the whole repository
- **GIVEN** a selected collection with some skills on
- **WHEN** the user presses All on, then All off
- **THEN** after each press every skill of the repository shows as pending in that state
- **AND** no selection callback is invoked until the user applies

#### Scenario: Folder-level all on stages one group only
- **GIVEN** a selected collection with skills in two folder groups, all off
- **WHEN** the user presses All on for one group
- **THEN** only that group's skills show as pending on, and the other group is unchanged

#### Scenario: Apply reports the whole pending selection once
- **GIVEN** pending switch changes across several groups of one repository
- **WHEN** the user applies them
- **THEN** the selection callback is invoked once with that repository's identity and the complete resulting set of skills that are on

#### Scenario: Discard restores the supplied state
- **GIVEN** pending switch changes
- **WHEN** the user discards them
- **THEN** every switch shows the state the inventory supplies and no callback is invoked

#### Scenario: A pending selection stays with its repository
- **GIVEN** pending switch changes for one repository
- **WHEN** the user selects another repository and comes back
- **THEN** the other repository shows no pending change, and the first repository still shows its own

#### Scenario: The skills that are on can be found
- **GIVEN** a collection of several hundred skills with one skill on
- **WHEN** the repository is selected
- **THEN** that skill is listed above the folders with its folder and a way to turn it off, and the repository list says one skill is on
- **AND** the folder holding it is open while the other folders are folded, and the filter for skills that are on lists that skill alone

#### Scenario: Search narrows a collection's skills
- **GIVEN** a selected collection
- **WHEN** the user searches for part of a skill's name or folder
- **THEN** only matching skills are listed, each in its folder, and a folder's All on turns on only its matching skills

#### Scenario: Remove repository requires confirmation
- **GIVEN** a selected repository whose resources are all user-registered and whose clone pi-outpost manages
- **WHEN** the user requests Remove repository
- **THEN** a confirmation names the repository and the path whose files will be deleted and states that this cannot be undone
- **AND** the removal callback is invoked only after the user confirms, and not at all if they cancel

#### Scenario: Removing an unmanaged repository says the files stay
- **GIVEN** a selected repository that pi-outpost does not manage
- **WHEN** the user requests Remove repository
- **THEN** the confirmation states that the repository will be unregistered and its files kept

#### Scenario: A configuration-file repository cannot be removed here
- **GIVEN** a selected repository that supplies a path declared in the configuration file
- **WHEN** its details are displayed
- **THEN** no Remove repository action is offered and the dialog says why
