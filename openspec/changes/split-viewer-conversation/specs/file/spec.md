# Spec Delta

## ADDED Requirements

### Requirement: ViewerBesideConversation

On a window wide enough for both, the frontend SHALL let the user show the file viewer beside a live conversation instead of overlaying the chat pane, and return to the overlay. The divider SHALL be adjustable within minimum pane widths. Below the width threshold, the viewer SHALL overlay the chat pane as in `FullSizeFileViewer`. The layout choice SHALL be remembered in the same browser.

#### Scenario: FollowTheAgentWhileWriting
- **GIVEN** a wide window, a writable file open in Edit mode with unsaved text, and the agent streaming a reply
- **WHEN** the user switches the viewer to side-by-side
- **THEN** the conversation is visible beside the editor and keeps updating as the reply streams
- **AND** the editor still holds the unsaved text, with the caret where it was

#### Scenario: TypingIsNotInterruptedByStreaming
- **GIVEN** the side-by-side layout with the editor focused
- **WHEN** the agent streams text and tool activity into the conversation
- **THEN** focus, caret and selection stay in the editor and every typed character lands in the file draft

#### Scenario: NarrowWindowKeepsTheOverlay
- **GIVEN** a window narrower than the threshold
- **WHEN** a file is opened
- **THEN** it is shown in the full-size overlay and no side-by-side option is offered

#### Scenario: LayoutChoiceIsRemembered
- **GIVEN** the user chose side-by-side and closed the viewer
- **WHEN** another file is opened in a wide window
- **THEN** it opens side by side

### Requirement: ViewerStateSurvivesLayoutChanges

Switching between overlay and side-by-side, crossing the width threshold, and the agent streaming in the conversation SHALL NOT discard the viewer's edit draft, undo history, caret, selection or scroll position, and SHALL NOT move focus out of the editor.

#### Scenario: ShrinkingTheWindowKeepsTheDraft
- **GIVEN** the side-by-side layout with unsaved edits
- **WHEN** the window is narrowed below the threshold
- **THEN** the viewer becomes the overlay with the same unsaved text, caret and undo history

### Requirement: MoveFocusBetweenEditorAndComposer

The frontend SHALL provide keyboard shortcuts that focus the composer from the viewer and return focus to the viewer's editor, restoring its last caret and selection. The shortcuts SHALL work in overlay and side-by-side layouts, SHALL NOT be keys the browser reserves or that the editor already binds, and SHALL NOT close the viewer or discard its draft.

#### Scenario: PromptWithoutLeavingTheFile
- **GIVEN** a file in Edit mode with the caret in the middle of a line
- **WHEN** the user presses the focus-composer shortcut, types a prompt and sends it
- **AND** presses the back-to-editor shortcut
- **THEN** the prompt is sent, the editor has focus with the caret where it was, and the draft is unchanged

### Requirement: AgentAttentionWhileInViewer

While the viewer is open, the frontend SHALL signal, without taking focus from the editor, that the agent asks a question, requests a sandbox grant, or has finished its turn. In the overlay layout the signal SHALL be visible on the viewer and SHALL offer an action that reveals the conversation; in the side-by-side layout the conversation pane shows it.

#### Scenario: QuestionArrivesWhileWritingInOverlay
- **GIVEN** a file open in the overlay with the editor focused
- **WHEN** the agent asks a question
- **THEN** a visible indicator appears on the viewer, the editor keeps focus, and its action shows the question
