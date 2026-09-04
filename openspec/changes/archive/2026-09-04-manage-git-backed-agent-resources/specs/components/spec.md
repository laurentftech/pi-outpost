## ADDED Requirements

### Requirement: AgentResourceManager

The component layer SHALL expose a dedicated Agent resources dialog from Settings as the single interactive surface for adding and removing user skill and extension roots. Settings SHALL retain the loaded and configured resource summary but SHALL open this dialog instead of presenting separate add-directory controls. The dialog SHALL present separate **Add local folder…** and **Add Git repository…** buttons. The dialog SHALL otherwise use a repository-first split layout: a searchable and filterable repository list with an attention summary on the left, and the selected repository's status, actions, skills, and extensions on the right. Non-Git and provenance-unavailable resources SHALL be reachable as non-updateable groups.

Repository identities are server-issued and do not outlive the server that issued them. The dialog SHALL treat an identity it can no longer resolve — after a reconnect, a restart, or an inventory that no longer contains it — as a stale selection, and SHALL fall back to a visible group rather than showing an empty detail pane or an operation aimed at nothing.

The component SHALL render only supplied inventory and operation state and SHALL report repository selection/enrollment, resource-root removal, refresh, update, confirmation, selection, search, and filtering requests through callbacks. It SHALL disable or withhold update actions when the supplied state is blocked, explain how local changes can be resolved externally, and require a separate explicit confirmation step for repositories marked as containing extensions. Results from an earlier selection or operation MUST NOT be presented as belonging to a newly selected repository.

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
- **THEN** the dialog presents the discovered skill and extension roots for selection
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
