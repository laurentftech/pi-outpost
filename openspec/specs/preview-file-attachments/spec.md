# Preview File Attachments Specification

## Purpose

Turns the file the user is looking at into the context of their next question, without making
them attach it by hand — and without spending the agent's context window on a file they may
never ask about. A previewed text file travels as an `@path` reference the agent resolves with
its own file tools; images, which the agent cannot hand to the model itself, travel as bytes.

## Requirements

### Requirement: Reference files from the file tree

- **Implementation**: `FileTree::ui/src/components/FileTree.tsx`, `addPathAttachment::ui/src/attachments.ts`

> `TreeNode` and `toggleAttachPath` are local to their modules and cannot be
> anchored; `FileTree` is the exported component that renders them, and
> `addPathAttachment` the exported state transition it drives.

The system SHALL let the user reference any file listed in the file tree as a prompt attachment without opening its preview, and SHALL let the user drop that reference the same way. The tree SHALL mark every file the next prompt references — whether the reference comes from an attachment or from an `@` mention typed in the draft — and SHALL surface the reference control itself only on hover, on devices that have hover.

#### Scenario: User references a file from the tree
- **WHEN** the user activates the reference control on a file in the tree
- **THEN** the composer contains a removable attachment for that file's path and the tree marks it as referenced

#### Scenario: Draft mentions a file by hand
- **WHEN** the user types an `@` mention of a file in the composer draft
- **THEN** the tree marks that file as referenced, and the reference control does not add a second reference to it

#### Scenario: A file is referenced twice
- **WHEN** a file is referenced from the tree while the same path is already attached, or its path is already typed as an `@` mention
- **THEN** the sent prompt mentions that path exactly once

### Requirement: PreviewWithoutImplicitAttachment
Opening, rendering, switching, refreshing or closing a file preview SHALL NOT add, remove or replace composer attachments. This applies to text, images, PDFs, tool-readable documents and unsupported binaries. Attachment changes SHALL require an explicit reference or import action.

#### Scenario: OpenFilesWithoutAttaching
- **WHEN** any supported or unsupported file is opened or rendered
- **THEN** no attachment is added and the next prompt does not reference that file implicitly

#### Scenario: PreserveExplicitAttachmentsWhileBrowsing
- **GIVEN** a file explicitly referenced in the composer
- **WHEN** other files are previewed, refreshed or closed
- **THEN** the explicit attachment is preserved unchanged

#### Scenario: ExplicitReferencesStillWork
- **WHEN** a user references a file from the tree, types an @ mention or imports a file
- **THEN** it is included by the existing explicit attachment flow
