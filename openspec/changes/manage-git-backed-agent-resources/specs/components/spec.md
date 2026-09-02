## ADDED Requirements

### Requirement: AgentResourceManager

The component layer SHALL expose a dedicated Agent resources dialog from Settings without removing the existing skill-path and extension-path configuration controls. The dialog SHALL use a repository-first split layout: a searchable and filterable repository list with an attention summary on the left, and the selected repository's status, actions, skills, and extensions on the right. Non-Git and provenance-unavailable resources SHALL be reachable as non-updateable groups.

The component SHALL render only supplied inventory and operation state and SHALL report refresh, update, confirmation, selection, search, and filtering requests through callbacks. It SHALL disable or withhold update actions when the supplied state is blocked, explain how local changes can be resolved externally, and require a separate explicit confirmation step for repositories marked as containing extensions. Results from an earlier selection or operation MUST NOT be presented as belonging to a newly selected repository.

#### Scenario: Open repository-first resource manager
- **GIVEN** Settings is supplied with resource repository and inventory state
- **WHEN** the user opens Agent resources
- **THEN** a split dialog lists repository groups and shows the selected group's status, skills, and extensions

#### Scenario: Search and attention filters preserve repository context
- **GIVEN** the dialog contains several repositories with different resource kinds and states
- **WHEN** the user searches or filters by resource kind or attention state
- **THEN** only matching groups remain and the detail pane either retains a matching selection or selects a visible group

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

#### Scenario: Provenance-unavailable resources stay visible
- **GIVEN** inventory entries cannot be attributed to a Git repository
- **WHEN** the Agent resources dialog opens
- **THEN** those entries appear in an explicitly non-updateable group with the supplied reason

