## MODIFIED Requirements

### Requirement: FullSizeFileViewer

> Implementation: `FileViewer` in `web/src/components/FileViewer.tsx` · confidence: reviewed

The frontend SHALL display a selected file in a full-size viewer overlaying the chat pane (syntax highlighting, rendered-markdown toggle), instead of a narrow sidebar preview. Files the user may write (per the writable-zone state) SHALL offer an Edit mode with a save action; read-only files SHALL show a lock instead. A successful save returns to the rendered view (unless the user typed during the save round-trip, in which case the draft is kept). Closing the viewer with unsaved edits MUST require confirmation; the viewer is remounted per file path so a draft can never be saved onto another file. Once a file is successfully displayed, the frontend SHALL expose it as a removable attachment for the active composer — a text file by path reference, an image by its bytes within the image attachment limit.

#### Scenario: OpenFileFullSize
- **WHEN** a file is selected in the file browser
- **THEN** Its content is shown in a full-size viewer over the chat pane, closable via ✕ or Escape

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
- **THEN** the active composer has a removable attachment for it — the file's path for text, the image bytes for an image
