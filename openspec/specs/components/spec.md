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

### Requirement: ExtensionInteractionSurfaces

The component layer SHALL provide distinct surfaces for extension dialogs, notifications, and
widgets. `ExtensionDialog` SHALL render a supplied dialog request and report a dialog response.
Notification and widget components SHALL render the corresponding extension state supplied by the
application.

#### Scenario: RespondToExtensionDialog
- **GIVEN** a dialog request supplied to `ExtensionDialog`
- **WHEN** the user completes or cancels the dialog
- **THEN** the component reports a dialog response through its response callback

#### Scenario: RenderExtensionNotifications
- **GIVEN** extension notification state supplied by the application
- **WHEN** `ExtensionNotifications` renders
- **THEN** the notifications are presented by the dedicated extension surface

#### Scenario: RenderExtensionWidgets
- **GIVEN** extension widget state supplied by the application
- **WHEN** `ExtensionWidgets` renders
- **THEN** the widgets are presented by the dedicated extension surface

### Requirement: RuntimeControls

The component layer SHALL expose runtime controls through `Header`, `ModelBar`, `SettingsMenu`,
`Onboarding`, `TokenGate`, and `TreeMenu`. These components SHALL render only the runtime,
configuration, credential, authentication, session-tree, and version state supplied to them and
SHALL report requested changes through callbacks.

#### Scenario: ChangeModelOrThinkingLevel
- **GIVEN** model choices and thinking state supplied to `ModelBar`
- **WHEN** the user selects a model or thinking level
- **THEN** the corresponding callback is invoked with the requested value

#### Scenario: PresentSandboxSettings
- **GIVEN** sandbox, extension-path, and version state supplied to `SettingsMenu`
- **WHEN** the settings menu is opened
- **THEN** the supplied settings and version information are presented

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

## Technical Notes

- **Defining location**: `ui/src/components/`
- **Consumer**: `ui/src/App.tsx`
- **Supporting state and types**: `ui/src/useAgent.ts`
- **Supporting utilities**: `ui/src/attachments.ts`, `ui/src/util/`
