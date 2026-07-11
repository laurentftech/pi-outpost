# Delta: file — file-viewer-editor

## ADDED Requirements

### Requirement: WriteFileFromBrowser

The system SHALL write a file back from the file browser, enforcing the same permission rules
as the agent's write tool: allowed when no sandbox is configured, or when the sandbox has
`allowWrite` enabled and the resolved path (symlink-safe) is inside the writable zone. The
written content MUST NOT exceed the preview size limit, so a saved file always remains
reopenable in the viewer.

#### Scenario: SaveInsideWritableZone
- **WHEN** write_file is called for a path inside the writable zone with current expectedMtimeMs
- **THEN** The file is written and a success response with the new size and mtimeMs is returned
- **AND** A file_changed notification is broadcast to all connected clients

#### Scenario: SaveOutsideWritableZone
- **WHEN** write_file is called for a path outside the writable zone (or writes are disabled)
- **THEN** The write is refused with a denied/outside-root error and the file is unchanged

#### Scenario: SaveTooLarge
- **WHEN** write_file is called with content larger than the preview size limit
- **THEN** The write is refused with a too-large error

### Requirement: DetectConcurrentModification

The system SHALL detect that a file changed on disk between opening and saving, by comparing
the mtime supplied by the client (`expectedMtimeMs`, obtained when the file was read) against
the file's current mtime before writing. On mismatch or if the file no longer exists, the
write MUST be refused with a conflict error instead of silently overwriting.

#### Scenario: FileChangedSinceOpen
- **WHEN** write_file is called with an expectedMtimeMs older than the file's current mtime
- **THEN** The write is refused with a conflict error
- **AND** The client offers to reload the file instead of overwriting

#### Scenario: FileDeletedSinceOpen
- **WHEN** write_file is called for a file that no longer exists
- **THEN** The write is refused with a conflict error (even with force)

#### Scenario: ExplicitOverwrite
- **WHEN** write_file is called with force after the user chose "overwrite" on the conflict banner
- **THEN** The mtime comparison is skipped and the write proceeds (permission and size checks still apply)

### Requirement: FullSizeFileViewer

The frontend SHALL display a selected file in a full-size viewer overlaying the chat pane
(syntax highlighting, rendered-markdown toggle), instead of only the narrow sidebar preview.
Files the user may write (per the writable-zone state) SHALL offer an Edit mode with a save
action; read-only files SHALL hide or disable editing. Closing the viewer with unsaved edits
MUST require confirmation.

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

## MODIFIED Requirements

### Requirement: ReadFileForPreview

> Implementation: `readFileForPreview` in `server/src/fileBrowser.ts` (limit `MAX_PREVIEW_BYTES` = 1 MiB) · confidence: reviewed

The system SHALL read a file for preview within the constrained structure, truncating content
beyond the preview size limit, and SHALL return the file's mtime (`mtimeMs`) alongside content
and size so the client can later detect concurrent modification when saving.

#### Scenario: ValidFile
<!-- openlore-test: tags=smoke (auto) -->
- **GIVEN** Valid root and relPath pointing to an existing file inside it
- **WHEN** readFileForPreview is called
- **THEN** The file content is returned with its size and mtimeMs, truncated at MAX_PREVIEW_BYTES

#### Scenario: InvalidFile
<!-- openlore-test: tags=regression (auto) -->
- **GIVEN** Valid root and relPath pointing outside the root or to a non-existent file
- **WHEN** readFileForPreview is called
- **THEN** An error is thrown
