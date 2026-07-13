## MODIFIED Requirements

### Requirement: SendMessage

> Implementation: `send` / `prompt` in `web/src/useAgent.ts` · confidence: reviewed

The system SHALL send ClientMessage frames (prompt with optional images, abort, session and tree operations…) to the server over the WebSocket as JSON. Before sending a prompt, the composer SHALL append each referenced file path as an `@path` mention (skipping a path the prompt already mentions), inline every attached text file the user supplied from their machine, and send all current image attachments as optional images. Attachments created automatically from the active file preview follow the same rules.

#### Scenario: SuccessfulMessageSend
<!-- openlore-test: tags=smoke (auto) -->
- **GIVEN** An active WebSocket connection
- **WHEN** an action (e.g. `prompt`) is called
- **THEN** The corresponding ClientMessage is serialized and sent to the backend

#### Scenario: SendPromptWithPreviewAttachment
- **GIVEN** a current automatic attachment from a file preview
- **WHEN** the user sends a prompt
- **THEN** the prompt mentions the previewed file's path (text) or includes the preview image in its optional images

#### Scenario: FailedMessageSend
<!-- openlore-test: tags=regression (auto) -->
- **GIVEN** No active WebSocket connection
- **WHEN** an action is called
- **THEN** The message is not sent and the UI reflects the disconnected state
