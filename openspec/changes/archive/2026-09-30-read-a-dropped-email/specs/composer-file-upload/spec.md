## MODIFIED Requirements

### Requirement: Route a supplied file by what the agent can do with it

The system SHALL classify every file supplied from outside the workspace — whether dropped on the
application or chosen through the composer's attach button — and SHALL treat both sources
identically.

A file whose type has a path-based extraction tool (PDF, `.docx`, `.xlsx`, `.pptx`, and an email
message: `.msg`, `.eml`, `.emlx`) SHALL be copied into the workspace and attached as a path
reference. Its bytes MUST NOT travel with the prompt.

The email formats SHALL be routed this way whatever their size, ahead of the inline text limit. A
`.eml` is text, and inlining it would carry MIME headers, boundary markers and the base64 of every
attachment into the prompt in place of the message — which is what the tool that reads it exists to
prevent. A `.msg` is not text at all, and MUST NOT be refused as an unsupported binary.

An image within the image attachment limit SHALL be attached as image bytes, because the agent
cannot hand image bytes to the model on its own. It MUST NOT be copied into the workspace: the
prompt already carries it, nothing would reference the copy, and a write the user did not ask for
is not a free one. An image beyond that limit SHALL be copied into the workspace and attached as a
path reference rather than refused.

A text file within the inline text limit SHALL continue to be attached as inline text, without
being copied into the workspace. A text file beyond that limit but within the maximum upload size
SHALL be copied into the workspace and attached as a path reference, since the agent reads a path
without the prompt paying for the content.

Any other file SHALL be refused with a message naming its own reason. A refusal MUST NOT report a
binary file as oversized text, and MUST NOT quote the inline text limit for a file that was
refused against a different one.

#### Scenario: Dropped PDF becomes a path reference
- **WHEN** the user drops a PDF no larger than the maximum upload size on the application
- **THEN** the file is copied into the workspace, the composer holds a removable attachment for the
  copy's path, the sent prompt mentions that path, and the PDF's bytes are not part of the prompt

#### Scenario: Attach button and drop behave alike
- **WHEN** the user chooses a `.docx` file through the composer's attach button
- **THEN** the resulting attachment is the same path reference a drop of that file produces

#### Scenario: Dropped Outlook message becomes a path reference
- **WHEN** the user drops a `.msg` file dragged out of Outlook
- **THEN** the file is copied into the workspace and attached as a path reference, and it is not
  reported as an unsupported binary file

#### Scenario: Small dropped .eml is referenced, not inlined
- **WHEN** the user drops a `.eml` file smaller than the inline text limit
- **THEN** the file is copied into the workspace and attached as a path reference, and its MIME
  source is not part of the prompt

#### Scenario: Image within the limit is shown to the model without a copy
- **WHEN** the user drops or pastes an image no larger than the image attachment limit
- **THEN** the composer holds an image attachment carrying its bytes, and no copy is written into
  the workspace

#### Scenario: Image within the limit survives a workspace that cannot be written
- **GIVEN** a sandbox that does not allow writes
- **WHEN** the user pastes an image no larger than the image attachment limit
- **THEN** the image is still attached as bytes and no error is reported, because the attachment
  never depended on a copy

#### Scenario: Oversized image is referenced instead of refused
- **WHEN** the user drops an image larger than the image attachment limit
- **THEN** the file is copied into the workspace and attached as a path reference, and no
  size-related error is reported

#### Scenario: Small text file is still inlined
- **WHEN** the user drops a text file within the inline text limit
- **THEN** its content is attached inline and no copy is made in the workspace

#### Scenario: Large text file is referenced instead of refused
- **WHEN** the user drops a text file larger than the inline text limit but within the maximum
  upload size
- **THEN** the file is copied into the workspace and attached as a path reference, and the inline
  text limit is not reported as the reason for anything

#### Scenario: Unsupported binary names its own reason
- **WHEN** the user drops a file that is neither an image, nor text, nor a format with a
  path-based extraction tool
- **THEN** the composer reports that the file's type is not supported, and does not report it as
  exceeding the text limit
