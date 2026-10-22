## REMOVED Requirements

### Requirement: Automatically attach the active preview

**Reason**: Opening a file must not select prompt context implicitly.
**Migration**: Use the tree reference control, an @ mention, or explicit file import.

### Requirement: Synchronize automatic attachment with preview selection

**Reason**: Opening a file must not select prompt context implicitly.
**Migration**: Use the tree reference control, an @ mention, or explicit file import.

### Requirement: Allow automatic attachment removal

**Reason**: Opening a file must not select prompt context implicitly.
**Migration**: Use the tree reference control, an @ mention, or explicit file import.

### Requirement: Degrade safely for unsendable previews

**Reason**: Opening a file must not select prompt context implicitly.
**Migration**: Use the tree reference control, an @ mention, or explicit file import.

### Requirement: Automatically attach tool-readable binary selections

**Reason**: Opening a file must not select prompt context implicitly.
**Migration**: Use the tree reference control, an @ mention, or explicit file import.

## ADDED Requirements

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
