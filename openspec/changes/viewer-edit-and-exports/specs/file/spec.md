## ADDED Requirements

### Requirement: EditingFromTheRenderingMovesToTheText

When the reader opens the editor while a file with a rendering shows that rendering, the viewer SHALL
show the editor beside the rendering, or the source alone when there is no room for two panes. Leaving
the editor SHALL bring the rendering back, unless the reader chose another mode meanwhile.

#### Scenario: EditFromTheRenderingGoesBesideIt
- **GIVEN** a Markdown, HTML or structured-exchange file shown rendered, with room for two panes
- **WHEN** the reader clicks edit, then done
- **THEN** the side-by-side mode is shown with the editor and the rendering, and after done the rendering alone again

#### Scenario: EditFromTheRenderingWithoutRoomShowsTheSource
- **GIVEN** a file shown rendered, without room for two panes
- **WHEN** the reader clicks edit, then done
- **THEN** the source mode is shown with the editor, and after done the rendering again

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
- **WHEN** a file is selected in the file browser
- **THEN** Its content is shown in a full-size viewer over the chat pane, closable via ✕ or Escape

#### Scenario: OpenPdfFullSize
- **WHEN** a PDF is selected in the file browser
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
- **WHEN** the selected file has been displayed successfully
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
