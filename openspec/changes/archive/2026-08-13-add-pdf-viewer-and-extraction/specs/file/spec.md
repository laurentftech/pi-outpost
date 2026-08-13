## MODIFIED Requirements

### Requirement: CreateSandboxedTools

> Implementation: `createSandboxedTools` in `server/src/sandbox.ts` · confidence: reviewed

The system SHALL create a set of sandboxed tool definitions from a SandboxConfig: read/ls/grep/find
and PDF extraction confined to `root` (the read-only zone) plus the configured read-only exception
roots derived from skill, prompt, and extension locations; edit/write only when `allowWrite` is
true, further confined to `writableRoot` when set (the read-write zone) and never extended by those
exceptions; bash only when `allowBash` is true (bash cannot be path-scoped, so it is an explicit
opt-in). All roots and requested paths SHALL be checked after resolving symlinks.

PDF extraction SHALL be a read tool: available whenever the read tools are, denied wherever they
are denied, and never gated behind `allowBash`.

#### Scenario: CreateToolsWithValidConfig
<!-- openlore-test: tags=smoke (auto) -->
- **GIVEN** A valid SandboxConfig
- **WHEN** createSandboxedTools is called
- **THEN** Returns an array of ToolDefinition objects matching the configured permissions

#### Scenario: ReadOnlyByDefault
<!-- openlore-test: tags=regression (auto) -->
- **GIVEN** A SandboxConfig with `allowWrite: false` and `allowBash: false`
- **WHEN** createSandboxedTools is called
- **THEN** The returned tools contain no edit, write, or bash tool
- **AND** The returned tools still contain the PDF extraction tool

#### Scenario: ReadConfiguredResourceOutsideRoot
- **GIVEN** a skill, prompt, extension directory, or extension script configured outside `sandbox.root`
- **WHEN** a read, ls, grep, or find tool accesses a path inside that configured location
- **THEN** the read operation is allowed

#### Scenario: ExceptionDoesNotGrantWriteAccess
- **GIVEN** a configured read-only exception outside `sandbox.root` and sandbox writes enabled
- **WHEN** an edit or write tool targets a path inside that exception
- **THEN** the operation is denied because the path is outside the writable root

#### Scenario: UnrelatedPathRemainsDenied
- **GIVEN** one or more configured read-only exceptions
- **WHEN** a read tool targets a path outside both `sandbox.root` and every exception root, including a prefix look-alike
- **THEN** the operation is denied

#### Scenario: PdfExtractionIsPathConfined
- **GIVEN** a sandbox root
- **WHEN** the PDF extraction tool targets a path that resolves outside that root and outside every read exception
- **THEN** the operation is denied

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
