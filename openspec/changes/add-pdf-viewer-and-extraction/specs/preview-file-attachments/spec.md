## MODIFIED Requirements

### Requirement: Automatically attach the active preview

- **Implementation**: `textPreviewToAttachment::ui/src/attachments.ts`, `imagePreviewToAttachment::ui/src/attachments.ts`

The system SHALL add a successfully displayed file preview to the composer as the attachment for the active preview. It SHALL create at most one automatic attachment for an active preview path, and SHALL preserve manually added attachments.

Text files SHALL be attached as a path reference, not as content: the agent browses the same root as the file viewer and reads the file itself, so a large preview MUST NOT consume prompt context proportional to its size. PDFs SHALL likewise be attached as a path reference, because the agent has a tool that reads a PDF at a path — their bytes MUST NOT travel with the prompt. Images SHALL still be attached as image bytes, which the agent cannot supply to the model on its own.

#### Scenario: Text preview becomes a path reference
- **WHEN** a text file preview has loaded successfully
- **THEN** the composer contains a removable attachment referencing the file's path, and the prompt carries an `@path` mention rather than the file's content

#### Scenario: PDF preview becomes a path reference
- **WHEN** a PDF is displayed in the viewer
- **THEN** the composer contains a removable attachment referencing the file's path, and the PDF's bytes are not attached

#### Scenario: Image preview becomes an attachment
- **WHEN** an image file is displayed in the preview and its raw bytes can be read within the image attachment limit
- **THEN** the composer contains a removable image attachment for that image

#### Scenario: Same preview rerenders
- **WHEN** the active preview rerenders without a path change
- **THEN** the composer contains no duplicate automatic attachment
