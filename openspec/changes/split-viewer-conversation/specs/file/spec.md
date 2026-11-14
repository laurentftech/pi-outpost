# Spec Delta

## MODIFIED Requirements

### Requirement: FullSizeFileViewer

- **Implementation**: `FileViewer::ui/src/components/FileViewer.tsx`

The frontend SHALL display a selected file in a full-size viewer overlaying the chat pane
(syntax highlighting, rendered-markdown toggle), instead of a narrow sidebar preview.
A selected PDF SHALL be displayed as a rendered document rather than reported as unpreviewable
binary content, and SHALL be read-only: no Edit action is offered for it whatever the writable zone
says, because the viewer cannot produce PDF bytes back.
Files the user may write (per the writable-zone state) SHALL offer an Edit mode with a save
action; read-only files SHALL show a lock instead. The Edit mode SHALL behave as a code editor:
each line numbered in a gutter, a wrapped line keeping one number, the current line marked, the
text coloured with the file's syntax as it is typed, brackets and quotes closed as they are typed
and matching brackets shown, Tab typing the file's indentation unit at a bare cursor and indenting
a selection, Shift+Tab outdenting, several cursors (the next occurrence of the selection added by
Ctrl+D / Cmd+D), and an undo history. A file written with CRLF line endings SHALL be saved with
CRLF line endings. A text file's source, whenever it is shown without being edited — the source
view, and the side-by-side mode's left pane outside the writable zone — SHALL be shown in that
same editor, read-only: the same line numbers, colours and folding, nothing to type into. Ctrl+S (Cmd+S) SHALL save. A successful save — by the shortcut or the
save action — SHALL stay in the Edit mode with the saved text as the new baseline, keeping
anything typed during the save round-trip; with nothing unsaved, the action that leaves the editor
SHALL leave it without asking.
Closing the viewer with unsaved edits MUST require confirmation; the viewer is remounted per
file path so a draft can never be saved onto another file. Once a file is successfully displayed,
the frontend SHALL expose it as a removable attachment for the active composer — a text file or a
PDF by path reference, an image by its bytes within the image attachment limit.

A successfully displayed text file, other than a structured-exchange document, SHALL additionally offer an action that downloads it as a Word
document. This action is independent of the writable zone — it produces a download rather than a
workspace write, so a read-only file offers it exactly as a writable one does. It SHALL be offered
whatever the current view mode, since it exports the document rather than the view. It SHALL NOT be
offered for an image, a PDF, a file that has not loaded, or while the viewer is showing uncommitted
changes instead of the document. What the export contains is specified by the `docx-export`
capability.

#### Scenario: OpenFileFullSize
- **WHEN** a file is opened from the file browser — double-click, Enter, or a tap
- **THEN** Its content is shown in a full-size viewer over the chat pane, closable via ✕ or Escape

#### Scenario: OpenPdfFullSize
- **WHEN** a PDF is opened from the file browser
- **THEN** it is rendered in the full-size viewer, closable the same way, with no binary-file error

#### Scenario: PdfIsNotEditable
- **WHEN** a PDF is displayed in the viewer, including one inside the writable zone
- **THEN** no Edit action is offered

#### Scenario: EditableFile
- **WHEN** the opened file is inside the writable zone (or no sandbox is configured)
- **THEN** An Edit action is available; saving sends write_file with the file's mtime

#### Scenario: ReadOnlyFile
- **WHEN** the opened file is outside the writable zone or the sandbox is read-only
- **THEN** No Edit action is offered

#### Scenario: DirtyCloseConfirmed
- **WHEN** the viewer is closed while the edit buffer has unsaved changes
- **THEN** The user is asked to confirm before the edits are discarded

#### Scenario: PreviewAttachmentAvailable
- **WHEN** the opened file has been displayed successfully
- **THEN** the active composer has a removable attachment for it — the file's path for text and PDFs, the image bytes for an image

#### Scenario: WordDownloadOfferedForText
- **WHEN** a text file is displayed in the viewer
- **THEN** an action to download it as a Word document is available

#### Scenario: WordDownloadIgnoresTheWritableZone
- **GIVEN** a displayed text file outside the writable zone, showing the read-only lock
- **THEN** the Word download action is still offered

#### Scenario: NoWordDownloadForBinaryOrDiff
- **WHEN** the viewer is showing an image, a PDF, a file that failed to load, or the uncommitted diff
- **THEN** no Word download action is offered

#### Scenario: TheEditorNumbersAndColoursLines
- **WHEN** the user edits a source file whose language the viewer knows
- **THEN** every line, the last empty one included, carries its number, a long line that wraps carries one, the text shows its syntax colours as it is typed, an opened bracket is closed and matched, Tab and Shift+Tab indent and outdent, Ctrl+D adds the next occurrence as a second cursor, and undo takes an edit back

#### Scenario: SavingKeepsTheEditorOpen
- **WHEN** the user presses Ctrl+S (Cmd+S) in the editor and the save lands
- **THEN** the file is written, the editor stays open on the draft with nothing left unsaved, and leaving it asks nothing

#### Scenario: ACrlfFileStaysCrlf
- **GIVEN** a file whose lines end with CRLF
- **WHEN** the user adds a line in the editor and saves
- **THEN** every line of the saved file, the new one included, ends with CRLF

#### Scenario: TheSourceIsReadInTheEditor
- **WHEN** the user opens a source file without editing it
- **THEN** it is shown in the editor's presentation — numbered lines, syntax colours — and typing changes nothing

#### Scenario: AStructuredExchangeFileExportsWhatItDraws
- **GIVEN** a structured-exchange document shown rendered
- **WHEN** the reader looks at the viewer's toolbar
- **THEN** a graph, a sequence or a timeline offers its figure as SVG, a table offers a Word document holding the table and an Excel workbook, and neither offers its JSON as Word text

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

While the viewer overlays the chat pane, the frontend SHALL show on the viewer, without taking focus from the editor, whether the agent is replying, running a tool, has failed, has finished, or asks a question or a sandbox grant. Its action SHALL reveal the latest of the conversation without closing the viewer or discarding its draft.

#### Scenario: QuestionArrivesWhileWritingInOverlay
- **GIVEN** a file open in the overlay with the editor focused
- **WHEN** the agent asks a question
- **THEN** a visible indicator appears on the viewer, the editor keeps focus, and its action shows the question

#### Scenario: AFailedTurnIsNamed
- **GIVEN** a file open in the overlay
- **WHEN** the agent's turn fails with a provider error
- **THEN** the indicator says the agent hit an error and shows the error, rather than an empty reply

### Requirement: ALookAtTheConversation

Revealing the conversation from the overlay SHALL scroll it to the latest message and put focus in the composer, unless a question or grant stands in for it. A bar in the flow above the transcript, not over it, SHALL offer a way back to the file — restoring the editor's focus, caret and selection when it had focus — and, when there is room, a way to put the file beside the conversation directly.

#### Scenario: PeekingKeepsTheDraft
- **GIVEN** a file open in the overlay with unsaved edits and the editor focused
- **WHEN** the user reveals the conversation from the indicator and comes back
- **THEN** the conversation showed its latest message, and the viewer shows the same unsaved text with focus and caret where they were

#### Scenario: TypingWhileLookingGoesToTheComposer
- **GIVEN** the conversation revealed from the overlay
- **WHEN** the user types
- **THEN** the text lands in the composer

#### Scenario: FromALookStraightBeside
- **GIVEN** the conversation revealed from the overlay on a wide window
- **WHEN** the user chooses "beside chat" in the bar above it
- **THEN** the file is shown beside the conversation with its editor focused, caret where it was

### Requirement: ViewerControlsKeepTheEditorFocused

Pressing a control that keeps the editor on screen — the layout actions, the status strip's actions, save — SHALL NOT move focus out of the editor. These controls SHALL be at least 24 by 24 CSS pixels.

#### Scenario: SwitchAndKeepTyping
- **GIVEN** a file in Edit mode with the editor focused
- **WHEN** the user clicks "beside chat", then "over chat", then save
- **THEN** after each click the next keystroke lands in the editor

### Requirement: AttentionOutsideTheWindow

When the application's tab is not in front, the standalone frontend SHALL mark its document title when the agent asks a question or a sandbox grant, and when the agent finishes a turn, and SHALL remove the mark once the tab is in front again. An embedded widget SHALL leave the host page's title alone.

#### Scenario: AQuestionWhileAway
- **GIVEN** the application's tab in the background
- **WHEN** the agent asks a question
- **THEN** the tab's title starts with a mark saying the agent needs the user

#### Scenario: AReplyFinishedWhileAway
- **GIVEN** the application's tab in the background while the agent streams
- **WHEN** the turn ends
- **THEN** the tab's title starts with a mark saying the agent replied

#### Scenario: TheMarkGoesWhenTheUserIsBack
- **GIVEN** a marked title
- **WHEN** the tab comes to the front
- **THEN** the title returns to its unmarked form

### Requirement: OpenFilesAsTabs

Opening a file while another is shown SHALL show both as tabs above the viewer, the newly opened one active; a single open file SHALL show no tab bar. Opening a file that already has a tab SHALL activate that tab. Activating a tab SHALL show that file with its own unsaved edits, undo history, caret and scroll as they were.

#### Scenario: ASecondFileOpensTabs
- **GIVEN** one file open in the viewer, with no tab bar
- **WHEN** the user opens a second file
- **THEN** a tab bar shows both files, the second one active

#### Scenario: EachTabKeepsItsDraft
- **GIVEN** two tabs, the first with unsaved edits and its caret mid-line
- **WHEN** the user activates the second tab and then the first again
- **THEN** the first shows its unsaved edits, undo still takes them back, and the caret is where it was

#### Scenario: OpeningAnOpenFileActivatesItsTab
- **GIVEN** tabs for `a.md` and `b.md`, `b.md` active
- **WHEN** the user opens `a.md` from the tree
- **THEN** the `a.md` tab becomes active and no third tab appears

### Requirement: ClosingTabs

Closing a tab SHALL ask for confirmation when it holds unsaved edits and SHALL activate a neighbouring tab when it was the active one; closing the last tab SHALL close the viewer. Switching project SHALL close every tab.

#### Scenario: ClosingADirtyTabAsks
- **GIVEN** a tab with unsaved edits
- **WHEN** the user closes it and declines the confirmation
- **THEN** the tab and its edits stay

#### Scenario: ClosingTheActiveTabShowsItsNeighbour
- **GIVEN** tabs `a`, `b`, `c` with `b` active
- **WHEN** the user closes `b`
- **THEN** `c` becomes active; closing `c` and then `a` closes the viewer

#### Scenario: AnotherProjectClosesTheTabs
- **GIVEN** several tabs open
- **WHEN** the user switches to another project
- **THEN** no tab and no viewer remain
