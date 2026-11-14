# Spec Delta

## ADDED Requirements

### Requirement: ViewerBesideConversation

On a window wide enough for both, the frontend SHALL let the user show the file viewer beside a live conversation instead of overlaying the chat pane, and return to the overlay. The divider SHALL be adjustable within minimum pane widths. Opening a file SHALL leave the Files sidebar as the user set it. Below the width threshold, the viewer SHALL overlay the chat pane as in `FullSizeFileViewer`. The layout choice SHALL be remembered in the same browser.

#### Scenario: FollowTheAgentWhileWriting
- **GIVEN** a wide window, a writable file open in Edit mode with unsaved text, and the agent streaming a reply
- **WHEN** the user switches the viewer to side-by-side
- **THEN** the conversation is visible beside the editor and keeps updating as the reply streams
- **AND** the editor still holds the unsaved text, with the caret where it was

#### Scenario: SwitchBothWaysKeepsTheDraft
- **GIVEN** a file in Edit mode over the chat with an unsaved edit
- **WHEN** the user chooses "beside chat", then "over chat"
- **THEN** after each switch the unsaved edit is still there and undo still takes it back

#### Scenario: TypingIsNotInterruptedByStreaming
- **GIVEN** the side-by-side layout with the editor focused
- **WHEN** the agent streams text and tool activity into the conversation
- **THEN** focus, caret and selection stay in the editor and every typed character lands in the file draft

#### Scenario: TheFilesSidebarIsLeftAlone
- **GIVEN** the Files sidebar is open
- **WHEN** a file is opened side by side
- **THEN** the sidebar stays open and the viewer and conversation share the remaining width

#### Scenario: NarrowWindowKeepsTheOverlay
- **GIVEN** a window narrower than the threshold
- **WHEN** a file is opened
- **THEN** it is shown in the full-size overlay and no side-by-side option is offered

#### Scenario: LayoutChoiceIsRemembered
- **GIVEN** the user chose side-by-side and closed the viewer
- **WHEN** another file is opened in a wide window
- **THEN** it opens side by side

### Requirement: LayoutToggleActions

The overlay's status strip SHALL offer a "beside chat" action whenever the window is wide enough, and the side-by-side viewer SHALL offer an "over chat" action. Neither SHALL reuse the name of the viewer's rendered/split/source modes.

#### Scenario: TheToggleIsWhereTheEyeIs
- **GIVEN** a wide window and a file over the chat
- **THEN** the status strip offers "beside chat", and once side by side the viewer offers "over chat"

#### Scenario: NoBesideChatWhenNarrow
- **GIVEN** a window narrower than the threshold
- **THEN** the status strip does not offer "beside chat"

### Requirement: ViewerStateSurvivesLayoutChanges

Switching between overlay and side-by-side, crossing the width threshold, and the agent streaming in the conversation SHALL NOT discard the viewer's edit draft, undo history, caret, selection or scroll position, and SHALL NOT move focus out of the editor.

#### Scenario: ShrinkingTheWindowKeepsTheDraft
- **GIVEN** the side-by-side layout with unsaved edits
- **WHEN** the window is narrowed below the threshold
- **THEN** the viewer becomes the overlay with the same unsaved text, caret and undo history

### Requirement: SendingKeepsTheViewerOpen

Sending a prompt SHALL NOT close the file viewer, whether or not it holds unsaved edits, in either layout.

#### Scenario: PromptWhileReadingAFile
- **GIVEN** a file open in the viewer with nothing unsaved
- **WHEN** the user sends a prompt from the composer
- **THEN** the prompt is sent and the viewer stays open on the same file

### Requirement: FocusReturnsToTheEditorAfterSending

When the user moves from the viewer's editor directly to the composer and sends a prompt, the frontend SHALL return focus to that editor with its caret and selection as they were before, without any shortcut to learn. When focus reached the composer from anywhere else, it SHALL stay where the user put it.

#### Scenario: PromptWithoutLeavingTheFile
- **GIVEN** a file in Edit mode with the caret in the middle of a line
- **WHEN** the user clicks the composer, types a prompt and sends it
- **THEN** the prompt is sent and the editor has focus with the caret where it was
- **AND** the next character typed lands at that caret, not at the start of the file

#### Scenario: FocusFromElsewhereIsNotRedirected
- **GIVEN** the user was scrolling the conversation, not editing
- **WHEN** they send a prompt from the composer
- **THEN** focus is not moved into the viewer

### Requirement: AgentAttentionWhileInViewer

While the viewer overlays the chat pane, the frontend SHALL show on the viewer, without taking focus from the editor, whether the agent is replying, running a tool, has failed, has finished, or asks a question or a sandbox grant, and SHALL offer an action that reveals the conversation without closing the viewer or discarding its draft.

#### Scenario: QuestionArrivesWhileWritingInOverlay
- **GIVEN** a file open in the overlay with the editor focused
- **WHEN** the agent asks a question
- **THEN** a visible indicator appears on the viewer, the editor keeps focus, and its action shows the question

#### Scenario: PeekingKeepsTheDraft
- **GIVEN** a file open in the overlay with unsaved edits
- **WHEN** the user reveals the conversation from the indicator and comes back
- **THEN** the viewer shows the same unsaved text with the caret where it was
