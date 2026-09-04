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

`FileTree` SHALL expose callbacks for opening a file natively, renaming a file, deleting a file, moving a writable file to a directory, and copying a read-only file to a writable directory; it SHALL not perform filesystem operations itself. For a writable file, it SHALL expose rename and delete controls following the tree's existing hover/touch convention. Submitting a blank inline rename SHALL cancel the edit, restore the existing row, and report no rename request. It SHALL show a confirmation naming the target file before reporting a delete request, and cancellation SHALL report no request. It SHALL make a regular file row draggable and accept it only on a directory row that is a valid writable destination, reporting a move for a writable source and a copy for a read-only source. It SHALL expose native opening for any listed file inside the browser root, including a read-only file.

Every truncated file or directory label SHALL expose its complete entry name through the same hover tooltip convention used by the Git tree.

#### Scenario: Cancel a blank file rename
- **GIVEN** a writable file whose inline rename field is open
- **WHEN** the user clears the field and submits it
- **THEN** `FileTree` reports no rename request and restores the existing file row without an error

#### Scenario: Confirm a file deletion
- **GIVEN** a writable file in `FileTree`
- **WHEN** the user chooses delete and confirms the dialog
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
- **WHEN** the user activates its native-open control
- **THEN** `FileTree` reports the file path through its native-open callback

#### Scenario: Reveal a truncated entry name
- **GIVEN** a file or directory name is too long for the fixed-width Files panel
- **WHEN** the user hovers the truncated label
- **THEN** the browser tooltip exposes the complete entry name

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
- **GIVEN** `ModelBar` is supplied with a current model that accepts `low`, `medium` and `xhigh` but not `high`
- **WHEN** the thinking control is opened
- **THEN** it presents `off`, `low`, `medium` and `xhigh` as ordered stops and no `high`
- **AND** selecting the last stop reports `xhigh` through the callback

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

## Technical Notes

- **Defining location**: `ui/src/components/`
- **Consumer**: `ui/src/App.tsx`
- **Supporting state and types**: `ui/src/useAgent.ts`
- **Supporting utilities**: `ui/src/attachments.ts`, `ui/src/util/`
