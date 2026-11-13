# Components Specification

## Purpose

Defines the reusable React presentation and interaction layer in `ui/src/components`. These
components render application state supplied by their consumers and report user intent through
callbacks; server communication and persistent state remain outside this domain.

## Requirements

### Requirement: ConversationItemRendering

The component layer SHALL provide dedicated renderers for assistant, user, tool, and custom
conversation items. `AssistantMessage` SHALL support normalized markdown, Mermaid blocks,
workspace-file references, and copy actions. `ToolCard` SHALL delegate the choice of tool
renderer to the tool-result presentation registry rather than enumerating renderers itself,
and SHALL present the selected presentation together with the tool status and access to the
original input and output. When an extension supplies a collapsed rendering for a tool result,
`ToolCard` SHALL use it for the collapsed state. `CustomMessageCard` SHALL support
extension-rendered HTML and normalized markdown.

#### Scenario: AssistantContentIsRendered
- **GIVEN** an assistant item supplied by the application
- **WHEN** `AssistantMessage` renders the item
- **THEN** its supported markdown, diagram, workspace-reference, and copy affordances are presented through the component layer

#### Scenario: ToolOutputUsesSpecializedRenderers
- **GIVEN** a tool item supplied by the application
- **WHEN** `ToolCard` renders the item
- **THEN** it renders the presentation the registry selected for that item
- **AND** it does not itself inspect the tool identity or result shape to choose one

#### Scenario: CollapsedExtensionRenderingIsUsed
- **GIVEN** a tool item carrying a collapsed extension rendering
- **WHEN** `ToolCard` renders the item collapsed
- **THEN** the collapsed extension rendering is the content shown

#### Scenario: CustomExtensionMessageIsRendered
- **GIVEN** a custom conversation item supplied by an extension
- **WHEN** `CustomMessageCard` renders the item
- **THEN** supported rendered HTML or normalized markdown is displayed
### Requirement: PromptComposition

`Composer` SHALL present prompt composition from the connection, streaming, command, file-search,
and prefill state supplied by its consumer. It SHALL use the attachment composition utilities to
compose the submitted prompt and identify mentioned workspace paths, and SHALL report user actions
through callbacks rather than communicating with the server directly.

#### Scenario: ComposeConnectedPrompt
- **GIVEN** a connected, non-streaming application with composer input and attachments
- **WHEN** the user submits through `Composer`
- **THEN** the component composes the prompt and reports the submission through its callback

#### Scenario: PresentCommandAndFileChoices
- **GIVEN** command metadata or file-search state supplied to `Composer`
- **WHEN** the corresponding completion interaction is active
- **THEN** the available choices are presented from that supplied state

#### Scenario: ApplyPrefill
- **GIVEN** prefill state supplied to `Composer`
- **WHEN** the component receives that state
- **THEN** the prefill is made available for editing before submission
### Requirement: WorkspaceAndGitNavigation

The component layer SHALL provide `FileTree`, `FileViewer`, `Sidebar`, `GitMenu`,
`GitCommitView`, and `GitFileHistory` for workspace and repository navigation. `FileTree` SHALL
derive its presentation from supplied directory, writable-root, Git-status, open-file, and
attachment state. `FileTree` SHALL surface creation of a file or directory only where the supplied
writable-root state says writing is allowed, and SHALL report the requested path through a callback
rather than performing it. `FileViewer` SHALL compose syntax highlighting, copy, diff, markdown, and
workspace-path rendering components, and SHALL offer entry points to both the worktree diff and
the file's history. `GitFileHistory` SHALL derive its presentation from supplied file-history and
revision-pair state. Navigation and mutation requests SHALL be emitted through callbacks.

#### Scenario: SelectWorkspaceFile
- **GIVEN** a directory tree supplied to `FileTree`
- **WHEN** the user selects a file
- **THEN** `FileTree` reports the selected path through its file-selection callback

#### Scenario: RequestFileCreation
- **GIVEN** a writable directory in the tree supplied to `FileTree`
- **WHEN** the user names a new file there and confirms
- **THEN** `FileTree` reports the requested path through its creation callback and creates nothing itself

#### Scenario: RenderFileContent
- **GIVEN** file state supplied to `FileViewer`
- **WHEN** the viewer displays the file
- **THEN** it uses the applicable code, markdown, image, copy, or diff presentation support

#### Scenario: InspectCommit
- **GIVEN** Git status and log state supplied to `GitMenu`
- **WHEN** the user selects a commit
- **THEN** the selected SHA is reported for presentation by `GitCommitView`

#### Scenario: InspectFileHistory
- **GIVEN** file-history state supplied to `GitFileHistory`
- **WHEN** the user picks two revisions
- **THEN** the requested revision pair is reported through its diff-request callback
### Requirement: FileTree lifecycle controls

`FileTree` SHALL expose callbacks for opening a file natively, renaming a file or folder, deleting a file or folder, moving a writable file or folder to a directory, and copying a read-only file or folder to a writable directory; it SHALL not perform filesystem operations itself. For a writable file or folder, it SHALL offer rename and delete in the row's actions menu. Submitting a blank inline rename SHALL cancel the edit, restore the existing row, and report no rename request. It SHALL show a confirmation naming the target before reporting a delete request — for a folder, saying that everything inside it is deleted too — and cancellation SHALL report no request. It SHALL make a regular file or folder row draggable and accept it only on a directory row that is a valid writable destination other than the dragged folder or one of its descendants, reporting a move for a writable source and a copy for a read-only source. It SHALL offer native opening in the actions menu of any listed file inside the browser root, including a read-only file.

Every truncated file or directory label SHALL expose its complete entry name through the same hover tooltip convention used by the Git tree.

#### Scenario: Cancel a blank file rename
- **GIVEN** a writable file whose inline rename field is open
- **WHEN** the user clears the field and submits it
- **THEN** `FileTree` reports no rename request and restores the existing file row without an error

#### Scenario: Confirm a file deletion
- **GIVEN** a writable file in `FileTree`
- **WHEN** the user chooses Delete in its actions menu and confirms the dialog
- **THEN** `FileTree` reports one delete request for that file through its callback

#### Scenario: Cancel a file deletion
- **WHEN** the user cancels the deletion confirmation
- **THEN** `FileTree` reports no delete request and keeps the file row displayed

#### Scenario: Drag a file onto a writable folder
- **GIVEN** a file row and a writable destination directory row
- **WHEN** the user drops the file row on that directory
- **THEN** `FileTree` reports the source file and destination directory through its move callback

#### Scenario: Drag a read-only file onto a writable folder
- **GIVEN** a read-only regular file row and a writable directory row
- **WHEN** the user drops the file row on that directory
- **THEN** `FileTree` reports the source file and destination directory through its copy callback and indicates a copy drag effect

#### Scenario: Do not accept an invalid drop destination
- **GIVEN** a file row and a read-only directory row
- **WHEN** the user attempts to drop the file on that directory
- **THEN** `FileTree` does not report a move request

#### Scenario: Open a read-only file natively
- **GIVEN** a read-only file row
- **WHEN** the user chooses Open with associated app in its actions menu
- **THEN** `FileTree` reports the file path through its native-open callback

#### Scenario: Reveal a truncated entry name
- **GIVEN** a file or directory name is too long for the fixed-width Files panel
- **WHEN** the user hovers the truncated label
- **THEN** the browser tooltip exposes the complete entry name

#### Scenario: ConfirmAFolderDeletion
- **GIVEN** a writable folder in `FileTree`
- **WHEN** the user chooses Delete in its actions menu
- **THEN** the confirmation names the folder and says that everything inside it is deleted, and confirming reports one delete request for that folder

#### Scenario: DragAFolderOntoAWritableFolder
- **GIVEN** a writable folder row `drafts` and a writable folder row `archive`
- **WHEN** the user drops `drafts` on `archive`, and then tries to drop `drafts` on one of its own subfolders
- **THEN** `FileTree` reports one move of `drafts` to `archive`, and the drop on its subfolder is not accepted
### Requirement: Resizable Files Sidebar

When the Files sidebar is open, the component layer SHALL expose a focusable vertical resize handle on its right boundary. Pointer movement and keyboard commands on that handle SHALL change the sidebar width within a 224-pixel minimum and a 640-pixel maximum. The default width SHALL remain 288 pixels.

The component layer SHALL persist a valid user-selected width in local browser storage and restore it after the sidebar or application is reopened. Missing, malformed, or out-of-range stored values MUST be ignored or clamped without preventing the sidebar from rendering.

#### Scenario: Resize with pointer input
- **GIVEN** the Files sidebar is open at its current width
- **WHEN** the user drags its resize handle horizontally
- **THEN** the sidebar follows the horizontal pointer position and the main content uses the remaining width

#### Scenario: Enforce resizing bounds
- **GIVEN** the Files sidebar resize handle is active
- **WHEN** the user attempts to resize below 224 pixels or above 640 pixels
- **THEN** the displayed width is clamped to the applicable boundary

#### Scenario: Resize with the keyboard
- **GIVEN** the Files sidebar resize handle has keyboard focus
- **WHEN** the user presses Left Arrow or Right Arrow
- **THEN** the sidebar width decreases or increases by a consistent step within the same bounds

#### Scenario: Restore the preferred width
- **GIVEN** the user previously completed a resize to a valid width
- **WHEN** the Files sidebar or application is reopened
- **THEN** the sidebar restores that width instead of the default

#### Scenario: Recover from an invalid stored preference
- **GIVEN** the stored sidebar-width preference is missing, malformed, or outside the supported bounds
- **WHEN** the Files sidebar opens
- **THEN** the sidebar renders at the default width or the nearest supported boundary without an application error
### Requirement: Resizable File History Split

When file History presents its commit list and diff side by side, the component layer SHALL expose a focusable vertical resize handle between them. Pointer and keyboard resizing SHALL change the commit-list width within the same 224-pixel minimum and 640-pixel maximum, with 416 pixels as its default.

The History width SHALL use a local browser-storage preference distinct from the Files sidebar preference. When the History layout stacks the commit list above the diff, the component layer MUST preserve the stacked layout and MUST NOT expose an inapplicable vertical resize handle.

#### Scenario: Resize the History commit list
- **GIVEN** file History displays the commit list beside the diff
- **WHEN** the user drags the separator horizontally or resizes it with Left Arrow or Right Arrow
- **THEN** the commit-list width changes within 224–640 pixels and the diff uses the remaining width

#### Scenario: Restore independent panel widths
- **GIVEN** the user saved different valid widths for Files and the History commit list
- **WHEN** either surface is reopened
- **THEN** each surface restores its own width without changing the other preference

#### Scenario: Preserve the stacked History layout
- **GIVEN** file History displays the commit list above the diff in a narrow layout
- **WHEN** the History surface renders
- **THEN** the commit list retains its responsive stacked sizing and no vertical resize handle is available
### Requirement: ExtensionInteractionSurfaces

The component layer SHALL provide distinct surfaces for extension dialogs, notifications, and
widgets. `ExtensionDialog` SHALL render a supplied dialog request and report a dialog response.
Notification and widget components SHALL render the corresponding extension state supplied by the
application. A notification is an overlay above the rest of the interface, so `ExtensionNotifications`
SHALL report each notification's dismissal a fixed interval after that notification arrived — measured
from its arrival and unaffected by how often the application around it re-renders — and SHALL also
offer a dismiss control on each notification.

#### Scenario: RespondToExtensionDialog
- **GIVEN** a dialog request supplied to `ExtensionDialog`
- **WHEN** the user completes or cancels the dialog
- **THEN** the component reports a dialog response through its response callback

#### Scenario: RenderExtensionNotifications
- **GIVEN** extension notification state supplied by the application
- **WHEN** `ExtensionNotifications` renders
- **THEN** the notifications are presented by the dedicated extension surface

#### Scenario: DismissExtensionNotificationsOnSchedule
- **GIVEN** a notification presented by `ExtensionNotifications`
- **WHEN** the application around it re-renders repeatedly while the dismissal interval runs
- **THEN** the component reports that notification's dismissal once the interval has elapsed since it arrived

#### Scenario: DismissExtensionNotificationOnDemand
- **GIVEN** a notification presented by `ExtensionNotifications`
- **WHEN** the user activates that notification's dismiss control
- **THEN** the component reports that notification's dismissal

#### Scenario: RenderExtensionWidgets
- **GIVEN** extension widget state supplied by the application
- **WHEN** `ExtensionWidgets` renders
- **THEN** the widgets are presented by the dedicated extension surface
### Requirement: RuntimeControls

The component layer SHALL expose runtime controls through `Header`, `ModelBar`, `SettingsMenu`,
`Onboarding`, `TokenGate`, and `TreeMenu`. These components SHALL render only the runtime,
configuration, credential, authentication, session-tree, and version state supplied to them and
SHALL report requested changes through callbacks. `SettingsMenu` SHALL show the user's own
skill paths separately from built-in skills, SHALL NOT present the configuration file's skill paths
as editable, and SHALL offer server-directory exploration controls for every path-valued setting it
edits.

`ModelBar`'s thinking-level control SHALL offer only the levels supplied for the current model, in
the order supplied, and SHALL present a set with gaps as that many ordered stops rather than a
continuous range — every stop it shows SHALL be a level the model accepts, so a selection never
snaps back. Where no such list is supplied it SHALL fall back to the full set of known levels, which
is the behaviour before this control was made model-aware.

`SettingsMenu` SHALL offer the same controls for the user's own extension paths that it offers for
skill paths — server-directory exploration, per-entry removal, and reporting the result through its
update callback — and SHALL NOT present the configuration file's extension paths as editable.

Because an extension is code that runs with the agent's privileges, and a directory loads every
extension found inside it, `SettingsMenu` SHALL state that before an extension path is added,
in the flow that adds one rather than only in a caption. Where extension paths are locked it SHALL
offer no control that would change them.

Every inventory `SettingsMenu` presents SHALL be reachable from a single collapsed summary line
stating how many it holds — "3 extensions loaded" — rather than drawn open. A menu whose sections
are all expanded is one an installation with many resources cannot read; the count is what the
summary is for. Each list SHALL be presented in a stable order that does not depend on the order
the server happened to report.

#### Scenario: ChangeModelOrThinkingLevel
- **GIVEN** model choices and thinking state supplied to `ModelBar`
- **WHEN** the user selects a model or thinking level
- **THEN** the corresponding callback is invoked with the requested value

#### Scenario: TheThinkingControlOffersOnlyTheModelsLevels
- **GIVEN** `ModelBar` is supplied with a current model that accepts `off`, `low`, `medium` and `xhigh` but not `high`
- **WHEN** the thinking control is opened
- **THEN** it presents `off`, `low`, `medium` and `xhigh` as ordered stops and no `high`
- **AND** selecting the last stop reports `xhigh` through the callback

#### Scenario: AModelRequiringReasoningHasNoOffStop
- **GIVEN** a model whose accepted thinking levels start at `low` and exclude `off`
- **WHEN** the thinking control is opened and its lowest stop is selected
- **THEN** that stop selects `low` and the control offers no `off` stop
- **AND** switching to a model that accepts `off` restores that model's `off` stop

#### Scenario: TheThinkingControlFallsBackWithoutAList
- **GIVEN** `ModelBar` is supplied with no accepted-levels list for the current model
- **WHEN** the thinking control is opened
- **THEN** it offers the full set of known levels, as it did before

#### Scenario: PresentSandboxSettings
- **GIVEN** sandbox, extension-path, and version state supplied to `SettingsMenu`
- **WHEN** the settings menu is opened
- **THEN** the supplied settings and version information are presented

#### Scenario: Select a server skill directory
- **GIVEN** SettingsMenu is supplied with the user's skill paths and a server-directory explorer callback
- **WHEN** the user chooses a mounted directory for additional skills
- **THEN** SettingsMenu reports the selected server path in its requested settings update

#### Scenario: Remove a user skill path
- **GIVEN** SettingsMenu is supplied with a skill path the user added
- **WHEN** the user removes it and requests an apply
- **THEN** the requested update carries the remaining user skill paths and nothing from the configuration file

#### Scenario: Select a server extension directory
- **GIVEN** SettingsMenu is supplied with the user's extension paths and a server-directory explorer callback
- **WHEN** the user chooses a mounted directory for additional extensions
- **THEN** SettingsMenu reports the selected server path in its requested settings update

#### Scenario: Remove a user extension path
- **GIVEN** SettingsMenu is supplied with an extension path the user added
- **WHEN** the user removes it and requests an apply
- **THEN** the requested update carries the remaining user extension paths and nothing from the configuration file

#### Scenario: Adding an extension path says what it means
- **GIVEN** SettingsMenu is supplied with the user's extension paths
- **WHEN** the user starts adding an extension directory
- **THEN** the menu states that extensions are code run with the agent's privileges and that every extension in the directory is loaded, before the path is added

#### Scenario: A locked deployment offers no extension control
- **GIVEN** SettingsMenu is supplied with state reporting extension paths as locked
- **WHEN** the settings menu is opened
- **THEN** it presents the loaded extensions without any control that would add or remove one

#### Scenario: Every inventory opens from a counted summary
- **GIVEN** SettingsMenu is supplied with loaded extensions and skills
- **WHEN** the settings menu is opened
- **THEN** each inventory shows a summary line stating how many it holds, none of them expanded, and opening one reveals its entries

#### Scenario: Inventories read in a stable order
- **GIVEN** SettingsMenu is supplied with entries in an order the server chose
- **WHEN** the settings menu is opened
- **THEN** each list is presented in a stable order rather than the order supplied

#### Scenario: SubmitAuthenticationToken
- **GIVEN** `TokenGate` is displayed after authentication is required
- **WHEN** the user submits a token
- **THEN** the token is reported through the component's submit callback

#### Scenario: NavigateConversationTree
- **GIVEN** conversation-tree state supplied to `TreeMenu`
- **WHEN** the user selects a navigation or fork action
- **THEN** the requested action is reported through the corresponding callback
### Requirement: SharedPresentationPrimitives

The domain SHALL provide shared presentation primitives for copying text, syntax highlighting,
Mermaid diagrams, unified and split diffs, and rendered HTML. Higher-level components SHALL reuse
these primitives through the observed component relationships instead of embedding duplicate
presentations. `RenderedHtml` SHALL present only HTML produced by the server-side extension
render pipeline; content originating in a tool's own output SHALL NOT be routed to it.

#### Scenario: CopyPresentedText
- **GIVEN** text supplied to `CopyButton`
- **WHEN** the user activates the copy action
- **THEN** the supplied text is the content offered for copying

#### Scenario: RenderCodeWithPathContext
- **GIVEN** source text and a path supplied to `CodeHighlight`
- **WHEN** the component renders
- **THEN** it presents the source using the path as language context

#### Scenario: RenderDiffRows
- **GIVEN** diff lines supplied to `DiffBlock` or `SplitDiffBlock`
- **WHEN** the component renders
- **THEN** the lines are presented in the requested unified or split form

#### Scenario: RenderExtensionHtml
- **GIVEN** rendered HTML supplied to `RenderedHtml` by the extension render pipeline
- **WHEN** the component renders
- **THEN** the HTML is presented through the shared rendered-HTML surface

#### Scenario: ToolOutputIsNotRoutedToRenderedHtml
- **GIVEN** a tool result whose own output contains markup
- **WHEN** a presentation renders that output
- **THEN** the output is presented as inert text rather than through `RenderedHtml`
### Requirement: SharedGraphPrimitives

The component layer SHALL render the conversation tree and the file-history graph from one set of
lane primitives — lane geometry, palette, and the rail drawing — so the two read as one visual
language. The rail SHALL take its palette as a parameter, so a graph whose highlighted line always
holds the first lane and one whose highlight moves between lanes can each be coloured correctly
without duplicating the drawing. Lane layout SHALL be computed by pure functions, separately from
rendering.

#### Scenario: OneRailForBothGraphs
- **GIVEN** the conversation tree and the file-history graph
- **WHEN** either renders a row
- **THEN** both draw it with the same lane width, row height, node shapes, and fork curves

#### Scenario: PaletteIsSuppliedByTheGraph
- **WHEN** a graph marks the highlighted line per row rather than by lane
- **THEN** it supplies a palette that never yields the reserved color, so no other lane can claim it

#### Scenario: LayoutIsTestableWithoutRendering
- **WHEN** lane assignment is exercised
- **THEN** it can be computed and asserted without mounting a component
### Requirement: FileTreeReflectsDiskChanges

The frontend SHALL keep the file tree in agreement with the workspace without requiring the user
to act. On being told that a directory changed, it SHALL re-list that directory if the tree is
holding it, and SHALL ignore the notification otherwise — a directory nobody expanded has nothing
to refresh.

When the file open in the viewer lives in a directory that changed, the frontend SHALL reload it
through the channel that displays it: text through `read_file`, and images/PDFs through a
cache-busted raw-byte request. A preview SHALL NOT keep showing bytes that are no longer on disk.
An edit in progress SHALL NOT be discarded by this: unsaved work belongs to the user, and the
existing save-time conflict check is where that collision is resolved.

When multiple listings for one directory overlap, the frontend SHALL accept only the latest
request's response, so a slower old response cannot restore entries that have since changed.

Git status SHALL be refreshed on the same signal, so badges do not outlive the state they describe.

#### Scenario: HeldDirectoryIsRelisted
- **GIVEN** the tree is showing a directory's contents
- **WHEN** the frontend is told that directory changed
- **THEN** it requests that directory's listing again

#### Scenario: UnheldDirectoryIsIgnored
- **GIVEN** a directory the tree has never expanded
- **WHEN** the frontend is told that directory changed
- **THEN** no listing is requested for it

#### Scenario: OpenPreviewFollowsItsDirectory
- **GIVEN** a file displayed in the viewer, not being edited
- **WHEN** the frontend is told that the file's directory changed
- **THEN** the file's current bytes are fetched again so the viewer shows what is on disk

#### Scenario: LatestDirectoryListingWins
- **GIVEN** two overlapping listing requests for one directory
- **WHEN** the newer response arrives before the older response
- **THEN** the older response is ignored and cannot replace the newer entries

#### Scenario: EditInProgressSurvives
- **GIVEN** a file open in edit mode with unsaved changes
- **WHEN** the frontend is told that the file's directory changed
- **THEN** the unsaved buffer is left alone
### Requirement: ManualTreeRefresh

The frontend SHALL offer a control that re-lists every directory the tree is currently holding,
in one action. It SHALL be offered whether or not the server is watching the filesystem, because
a watcher that reports nothing — a filesystem that emits no events, a spent watch budget — is
indistinguishable from a workspace that did not change.

#### Scenario: RefreshRelistsEveryHeldDirectory
- **GIVEN** the tree is holding several directories' contents
- **WHEN** the user activates the refresh control
- **THEN** each of those directories is listed again

#### Scenario: RefreshIsAlwaysAvailable
- **GIVEN** any file tree
- **THEN** the refresh control is present, independently of whether directory watching is on
### Requirement: AModelWithOneLevelIsStatedNotDrawnAsARange

Where the accepted set supplied to `ModelBar` holds a single level, the thinking control
SHALL state that level rather than render a range with one stop. A range whose thumb
cannot move reads as a broken control, not as a fact about the model.

The control SHALL name the level the session holds as itself, even when it is not one of
the stops on offer, rather than redrawing it as the stop it happens to sit at. Settling
that mismatch belongs to the server; until it does, the interface SHALL not claim it has
already happened.

#### Scenario: ASingleAcceptedLevelIsStated
- **GIVEN** `ModelBar` is supplied with an accepted set holding only `off`
- **WHEN** the thinking control is opened
- **THEN** it states that the model accepts `off` only, and offers no range control

#### Scenario: ALevelOutsideTheAcceptedSetIsStillNamed
- **GIVEN** `ModelBar` is supplied with `high` as the current level and an accepted set without it
- **WHEN** the thinking control is opened
- **THEN** the control still reads `high`
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
### Requirement: ConversationFilterControls

`Header` SHALL expose the conversation's content filters as a single labelled menu rather than one button per kind. The menu SHALL render only the filter state supplied to it and SHALL report each requested change through a callback, holding no filtering state of its own. Its trigger SHALL carry the filtered/unfiltered state so it is legible while the menu is closed, and the menu SHALL be dismissible the way the application's other popovers are — a click outside it and the Escape key — so it cannot be stranded open over a conversation that has moved on.

Each entry SHALL be an accessible checkbox-like control reporting its checked state to assistive technology, where checked means the kind is shown.

`AssistantMessage` SHALL omit reasoning blocks when its consumer asks for them to be hidden, and SHALL render no visible container at all when that leaves the message with nothing to show, rather than an empty frame. Filtering SHALL be a rendering decision only: the component SHALL NOT discard the blocks it was given, so the same item renders in full once the filter is cleared.

#### Scenario: The filter menu reports intent rather than holding state
- **GIVEN** `Header` is supplied with filter state and a change callback
- **WHEN** the user toggles a kind in the menu
- **THEN** the requested kind and its new value are reported through the callback
- **AND** the header renders the state it was supplied rather than a state of its own

#### Scenario: The closed trigger says whether the conversation is filtered
- **GIVEN** `Header` is supplied with at least one kind hidden
- **WHEN** the menu is closed
- **THEN** the trigger presents the conversation as filtered

#### Scenario: The menu closes on outside click and Escape
- **GIVEN** the filter menu is open
- **WHEN** the user clicks outside it, or presses Escape
- **THEN** the menu closes and no filter change is reported

#### Scenario: Filter entries are checkboxes to assistive technology
- **GIVEN** the filter menu is open
- **WHEN** it is inspected through the accessibility tree
- **THEN** each entry exposes a checked state that matches whether that kind is shown

#### Scenario: AssistantMessage omits hidden reasoning
- **GIVEN** an assistant item carrying reasoning and answer blocks
- **WHEN** `AssistantMessage` renders it with reasoning hidden
- **THEN** the answer is rendered and no reasoning block is present

#### Scenario: A message left with nothing renders nothing
- **GIVEN** an assistant item whose only blocks are reasoning
- **WHEN** `AssistantMessage` renders it with reasoning hidden
- **THEN** it renders no visible message container

#### Scenario: Hidden content is not discarded
- **GIVEN** an assistant item rendered with reasoning hidden
- **WHEN** the same item is rendered again with reasoning shown
- **THEN** its reasoning is present in full
### Requirement: ACodeBlockCanBeCopied

Every code block shown as code in an assistant reply SHALL carry a copy control in its top-right corner that copies the block's content exactly, without its fence or language tag, and SHALL confirm the copy.

#### Scenario: CopyingACodeBlock
- **GIVEN** a reply containing a ```` ```ts ```` block
- **WHEN** the reader activates the block's copy control
- **THEN** the clipboard holds the block's content without the fence, and the control shows that it copied
### Requirement: MermaidActionsMatchOtherDiagrams

Mermaid SHALL show a visible action row below its picture, with the same action
styling as structured-exchange diagrams. Its source and orientation controls SHALL
remain available. A rendered Mermaid diagram SHALL offer download SVG inline and
in its full-size view. The file SHALL be standalone SVG with dimensions, readable
text labels and its own appearance.
Full-size diagram actions SHALL stay at the bottom left of the frame while only
the content scrolls. The close control SHALL stay at the top right.

#### Scenario: MermaidActionsMatchOtherDiagrams
- **WHEN** a Mermaid diagram finishes rendering
- **THEN** its actions are visible below the picture without hovering
- **AND** the full-size view also offers download SVG

#### Scenario: DownloadTheShownMermaid
- **GIVEN** a reader has turned a Mermaid diagram
- **WHEN** they download SVG
- **THEN** the SVG uses the direction shown and contains the diagram's labels
- **AND** the authored source remains unchanged

#### Scenario: EnlargedDiagramActionsStayFixed
- **GIVEN** a full-size diagram wider than its frame
- **WHEN** the reader scrolls the content horizontally or vertically
- **THEN** the actions stay at the bottom left of the frame and remain clickable
- **AND** the close control stays accessible

#### Scenario: FailedMermaidDownloadCanBeRetried
- **WHEN** producing the SVG fails
- **THEN** the error is reported, the diagram remains available and download can be retried

#### Scenario: AMermaidDownloadCannotOutliveItsSource
- **WHEN** download is requested repeatedly while an export is pending
- **THEN** only one export runs
- **AND** replacing the source before it completes prevents the obsolete file from downloading
### Requirement: HeaderControlsShareOneRow

`Header` SHALL keep its controls on one row of one height, none of them wrapping its label.
A label the user does not choose SHALL be cut rather than wrapped, its full text available
on hover. The extensions' statuses SHALL fold into one control listing them in full when
they do not fit the bar, and SHALL return inline once the bar has room for them again.

#### Scenario: EveryControlIsOneHeight
- **WHEN** the header shows a project, a branch, a title, statuses and every optional control
- **THEN** every control in the bar has the same height and a label that does not wrap

#### Scenario: ALongLabelIsCutNotWrapped
- **WHEN** the project's name or the branch is too long for the room left
- **THEN** it is cut with an ellipsis, and its full name is the control's title

#### Scenario: StatusesFoldWhenTheyDoNotFit
- **WHEN** the statuses would be cut or the bar would overflow
- **THEN** they fold into one control naming how many there are, which lists them in full and closes on Escape

#### Scenario: StatusesUnfoldWhenRoomReturns
- **WHEN** the bar grows well past the width at which the statuses folded
- **THEN** they return inline, and a list left open does not reappear at the next fold

### Requirement: FileTree row actions menu

Each file and folder row SHALL carry one actions menu, opened by a `⋯` control or by the row's context menu. Besides it the row SHALL carry only the git badge and the `@` reference toggle. The `⋯` and an unreferenced `@` SHALL follow the hover/touch convention. Items SHALL be labelled, each with its action's symbol, and grouped in a fixed order; an item the row cannot take SHALL be left out rather than disabled.

#### Scenario: AFileRowsMenuInItsOrder
- **GIVEN** a writable, git-modified file with every callback wired
- **WHEN** the user opens its actions menu
- **THEN** the items read, in order and grouped: Open, Show diff, Open with associated app, Show in file manager · Reference in prompt, Download · Rename…, Move to… · Delete…

#### Scenario: AFolderRowsMenu
- **GIVEN** a writable folder row with every callback wired
- **WHEN** the user opens its actions menu
- **THEN** the items read, in order and grouped: New file…, New folder…, Show in file manager · Reference in prompt, Download as .zip · Rename…, Move to… · Delete…

#### Scenario: AReadOnlyFileOffersOnlyWhatItCanTake
- **GIVEN** a read-only file, and a read-only folder
- **WHEN** the user opens each one's actions menu
- **THEN** Rename…, Move to…, Delete…, New file… and New folder… are absent, and Download and Reference in prompt are present on both, and Open on the file

#### Scenario: TheRootsOfferNoRemoval
- **GIVEN** the folder row that is the writable root itself
- **WHEN** the user opens its actions menu
- **THEN** Rename…, Move to… and Delete… are absent

#### Scenario: TheContextMenuOpensTheSameMenu
- **WHEN** the user right-clicks a row
- **THEN** the same actions menu opens at the pointer instead of the browser's own

#### Scenario: TheRowKeepsTheAtAndItsStates
- **GIVEN** a referenced, git-modified file and an unreferenced folder
- **THEN** the file's row shows the lit `@`, the git badge and `⋯`, the folder's row its `@` and `⋯`, and no other control

#### Scenario: EachItemCarriesItsSymbol
- **WHEN** the user opens a row's actions menu
- **THEN** each item shows its action's symbol beside its label — ↵ open, ± diff, ↗ open with app, ⌂ show in file manager, + new, @ reference, ⤓ download, ✎ rename, → move, × delete

#### Scenario: TheMenuIsAKeyboardMenu
- **GIVEN** an open actions menu
- **WHEN** the user moves with the arrow keys, presses Enter, or presses Escape
- **THEN** focus moves between items, Enter runs the focused item, Escape closes the menu, and focus returns to the row

#### Scenario: OneMenuAtATime
- **GIVEN** an open actions menu
- **WHEN** the user opens another row's menu, clicks outside it, or the listed project changes
- **THEN** the first menu is closed
### Requirement: FileTree multi-selection

`FileTree` SHALL let the user select several file and folder rows: Shift-click SHALL select every visible row between the anchor and the clicked row, Ctrl/Cmd-click SHALL add or remove one row, and Escape SHALL clear the selection. These clicks SHALL NOT open a file nor expand a folder, and a plain click that expands a folder SHALL NOT select it. An entry inside a selected folder SHALL be covered by it and acted on once. A path that leaves the listing SHALL leave the selection.

#### Scenario: ShiftClickSelectsARange
- **GIVEN** files `a`, `b`, `c`, `d` listed in that order and `a` clicked
- **WHEN** the user Shift-clicks `c`
- **THEN** `a`, `b` and `c` are selected, `d` is not, and the open file is unchanged

#### Scenario: CtrlClickTogglesOneFile
- **GIVEN** a selection of `a` and `b`
- **WHEN** the user Ctrl-clicks (Cmd-clicks on macOS) `b` and then `d`
- **THEN** the selection is `a` and `d`

#### Scenario: EscapeClearsTheSelection
- **GIVEN** a selection of several files
- **WHEN** the user presses Escape in the tree
- **THEN** nothing is selected

#### Scenario: ARangeIncludesVisibleFoldersOnly
- **GIVEN** an expanded folder between two files, and a collapsed folder whose entries are not shown
- **WHEN** the user Shift-clicks across them
- **THEN** every visible row in between is selected, both folder rows included, and none of the collapsed folder's entries

#### Scenario: ASelectedFolderCoversItsContent
- **GIVEN** the folder `docs` and the file `docs/a.md` are both selected
- **WHEN** the user deletes, moves, downloads or references the selection
- **THEN** the request carries `docs` once and not `docs/a.md`

#### Scenario: ExpandingAFolderDoesNotSelectIt
- **GIVEN** a folder opened with a plain click
- **WHEN** the user Ctrl-clicks two files inside it and deletes the selection
- **THEN** only those two files are requested for deletion, never the folder

#### Scenario: ASelectionDoesNotOutliveItsFiles
- **GIVEN** a selection including `b`
- **WHEN** `b` is deleted, or another project is listed
- **THEN** `b`, or the whole selection, is no longer selected
### Requirement: FileTree acts on a selection

The actions menu of a selected row SHALL act on the whole selection and say how many entries it covers; the menu of an unselected row SHALL first make that row the selection. On a selection it SHALL offer Delete…, Move to…, Download and Reference in prompt, each only when every selected entry can take it. Delete SHALL ask one confirmation naming the count. Download SHALL fetch one archive. Dropping a selected row on a folder SHALL move the selection.

#### Scenario: DeleteASelectionWithOneConfirmation
- **GIVEN** two writable files and one writable folder selected
- **WHEN** the user chooses Delete 3 items… and confirms once
- **THEN** `FileTree` reports one batch delete request for the three paths, and the confirmation says the folder's content goes with it

#### Scenario: DownloadASelectionAsOneArchive
- **GIVEN** a file and a folder selected
- **WHEN** the user chooses Download
- **THEN** one download is started, for one `.zip` holding both

#### Scenario: DragASelectionOntoAFolder
- **GIVEN** two writable files selected and a writable folder
- **WHEN** the user drags one of the selected rows onto the folder
- **THEN** `FileTree` reports one batch move of both paths to that folder

#### Scenario: AMixedSelectionOffersNoMutation
- **GIVEN** a selection holding a writable and a read-only file
- **WHEN** the user opens the menu of a selected row
- **THEN** Delete… and Move to… are absent, and Download and Reference in prompt are present

#### Scenario: TheMenuOfAnUnselectedRowActsOnThatRow
- **GIVEN** a selection of `a` and `b`
- **WHEN** the user opens the actions menu of `d`
- **THEN** the selection becomes `d` alone and the menu acts on `d`

#### Scenario: KeyboardShortcutsOnTheSelection
- **GIVEN** a focused selected row in a selection of writable entries
- **WHEN** the user presses Delete
- **THEN** the same single confirmation is asked as from the menu, and F2 on a single focused writable file or folder opens its rename
### Requirement: FileTree selection bar

While two or more entries are selected, `FileTree` SHALL show a bar above the listing that stays in view while the tree scrolls. It SHALL name how many entries are selected, offer the actions the selection's menu offers, each running on the whole selection exactly as from the menu, and offer a control that clears the selection. With fewer than two entries selected, no bar SHALL be shown.

#### Scenario: TheBarAppearsWithASelection
- **GIVEN** one file selected
- **WHEN** the user Ctrl-clicks a second entry, and then a third
- **THEN** a bar appears saying 2 selected, then 3 selected, and it holds the same actions as the menu of a selected row

#### Scenario: DeleteFromTheBar
- **GIVEN** three writable entries selected
- **WHEN** the user presses Delete in the bar and confirms once
- **THEN** `FileTree` reports one batch delete request for the three paths and the bar goes away

#### Scenario: TheBarClearsTheSelection
- **GIVEN** a selection and its bar
- **WHEN** the user presses the bar's clear control
- **THEN** nothing is selected and the bar is gone

#### Scenario: NoBarForOneEntry
- **GIVEN** a single file clicked, or no selection
- **THEN** no selection bar is shown
### Requirement: FileTree undo of the last change

After a move, a rename or a deletion made from the tree succeeds, for one entry or several, `FileTree` SHALL say what changed and offer to undo it, by a control and by Ctrl/Cmd+Z in the tree. Undoing SHALL move entries back where they came from, rename back, or restore what was deleted. The offer SHALL last until another file operation or its dismissal; an undo SHALL NOT offer an undo.

#### Scenario: UndoAMove
- **GIVEN** `inbox/a.txt` and `inbox/b.txt` moved to `archive`
- **WHEN** the user presses Undo in the tree
- **THEN** `FileTree` reports one move of `archive/a.txt` and `archive/b.txt` back to `inbox`, and says the move was undone

#### Scenario: UndoPutsEachBackWhereItCameFrom
- **GIVEN** `x/one.txt` and `y/two.txt` moved together to `archive`
- **WHEN** the user undoes it
- **THEN** `archive/one.txt` is moved back to `x`, and once that is answered `archive/two.txt` back to `y`

#### Scenario: UndoByKeyboard
- **GIVEN** a move just made from the tree
- **WHEN** the user presses Ctrl+Z (Cmd+Z on macOS) in the tree
- **THEN** the move is undone as with the Undo control

#### Scenario: UndoIsOfferedForTheLastMoveOnly
- **GIVEN** a move that can be undone
- **WHEN** another file operation starts, or the user dismisses the offer
- **THEN** no undo is offered any more

#### Scenario: AnUndoThatCannotBeDoneSaysWhy
- **GIVEN** a moved file whose original place has since been taken by another file of the same name
- **WHEN** the user undoes the move
- **THEN** that file is not moved back, nothing is overwritten, and the tree shows the refusal

#### Scenario: AnUndoIsNotUndone
- **WHEN** an undo has been answered
- **THEN** the tree says the move was undone and offers no undo of the undo

#### Scenario: UndoARename
- **GIVEN** `draft.md` renamed to `final.md` from the tree
- **WHEN** the user presses Undo
- **THEN** `FileTree` reports a rename of `final.md` back to `draft.md`, and says the rename was undone

#### Scenario: UndoADeletion
- **GIVEN** two files and a folder deleted from the tree, confirmed once
- **WHEN** the user presses Undo
- **THEN** `FileTree` asks the server to restore all three in one request, and says the deletion was undone
### Requirement: FileTree destination picking

Move to… SHALL put the tree in a destination-picking mode that names what is being moved: every writable folder row other than a moved folder or its descendants, and the workspace root, SHALL become a target; clicking one SHALL report the move and leave the mode; Escape or a Cancel control SHALL leave it without a request. Folders SHALL still expand while picking.

#### Scenario: PickADestination
- **GIVEN** two writable files and Move to… chosen on them
- **WHEN** the user expands `archive` and clicks `archive/2026`
- **THEN** `FileTree` reports one move of both files to `archive/2026` and the tree leaves picking mode

#### Scenario: CancelPicking
- **GIVEN** the tree is picking a destination
- **WHEN** the user presses Escape or Cancel
- **THEN** no move is reported and the tree is back to normal

#### Scenario: AReadOnlyFolderIsNoTarget
- **GIVEN** the tree is picking a destination
- **THEN** a read-only folder cannot be clicked as a target

#### Scenario: AMovedFolderIsNoTargetForItself
- **GIVEN** the tree is picking a destination for the folder `project`
- **THEN** neither `project` nor any folder inside it can be clicked as a target

## Technical Notes

- **Defining location**: `ui/src/components/`
- **Consumer**: `ui/src/App.tsx`
- **Supporting state and types**: `ui/src/useAgent.ts`
- **Supporting utilities**: `ui/src/attachments.ts`, `ui/src/util/`
