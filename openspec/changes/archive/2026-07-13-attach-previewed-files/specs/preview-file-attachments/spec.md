## ADDED Requirements

### Requirement: Automatically attach the active preview
The system SHALL add a successfully displayed file preview to the composer as the attachment for the active preview. It SHALL create at most one automatic attachment for an active preview path, and SHALL preserve manually added attachments.

Text files SHALL be attached as a path reference, not as content: the agent browses the same root as the file viewer and reads the file itself, so a large preview MUST NOT consume prompt context proportional to its size. Images SHALL still be attached as image bytes, which the agent cannot supply to the model on its own.

#### Scenario: Text preview becomes a path reference
- **WHEN** a text file preview has loaded successfully
- **THEN** the composer contains a removable attachment referencing the file's path, and the prompt carries an `@path` mention rather than the file's content

#### Scenario: Image preview becomes an attachment
- **WHEN** an image file is displayed in the preview and its raw bytes can be read within the image attachment limit
- **THEN** the composer contains a removable image attachment for that image

#### Scenario: Same preview rerenders
- **WHEN** the active preview rerenders without a path change
- **THEN** the composer contains no duplicate automatic attachment

### Requirement: Synchronize automatic attachment with preview selection
The system SHALL replace the previous automatic attachment when a different file becomes the active preview. It SHALL not remove manually added attachments during that replacement.

#### Scenario: User previews another file
- **WHEN** the user changes the active preview from one file to another
- **THEN** the previous preview attachment is replaced by an attachment for the newly previewed file

### Requirement: Allow automatic attachment removal
The system SHALL allow the user to remove an automatic preview attachment through the existing attachment control. It SHALL keep the attachment removed while that file remains the active preview.

#### Scenario: User removes the preview attachment
- **WHEN** the user removes the automatic attachment for the active preview
- **THEN** it is absent from the composer and is not recreated until the active preview changes

### Requirement: Reference files from the file tree
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

### Requirement: Degrade safely for unsendable previews
The system SHALL not attach a preview whose image content is unsupported, unreadable, or exceeds the established image attachment limit. It SHALL leave the preview available and report a non-blocking attachment error.

#### Scenario: Oversized image preview
- **WHEN** a successfully displayed image preview exceeds the image attachment size limit
- **THEN** the preview remains displayed, no automatic attachment is added, and the composer reports why it was skipped

#### Scenario: Large text preview
- **WHEN** a successfully displayed text preview is larger than the composer's inline text limit
- **THEN** it is still attached, because only its path travels with the prompt
