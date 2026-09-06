## MODIFIED Requirements

### Requirement: FullSizeFileViewer

- **Implementation**: `FileViewer::ui/src/components/FileViewer.tsx`

The frontend SHALL display a selected file in a full-size viewer overlaying the chat pane
(syntax highlighting, rendered-markdown toggle), instead of a narrow sidebar preview.
A selected PDF SHALL be displayed as a rendered document rather than reported as unpreviewable
binary content, and SHALL be read-only: no Edit action is offered for it whatever the writable zone
says, because the viewer cannot produce PDF bytes back.
Files the user may write (per the writable-zone state) SHALL offer an Edit mode with a save
action; read-only files SHALL show a lock instead. A successful save returns to the rendered
view (unless the user typed during the save round-trip, in which case the draft is kept).
Closing the viewer with unsaved edits MUST require confirmation; the viewer is remounted per
file path so a draft can never be saved onto another file. Once a file is successfully displayed,
the frontend SHALL expose it as a removable attachment for the active composer — a text file or a
PDF by path reference, an image by its bytes within the image attachment limit.

A successfully displayed text file SHALL additionally offer an action that downloads it as a Word
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
