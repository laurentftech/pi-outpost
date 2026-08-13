## ADDED Requirements

### Requirement: CreateEntryMessages

The WebSocket protocol SHALL carry a `create_file` and a `create_directory` client message, each
naming a path relative to the browser root and a request id. The server SHALL answer a successful
`create_file` with the same message that answers a write — path, size and mtime — so the client can
open the new file without a second round trip, and a successful `create_directory` with a directory
listing of its parent or an equivalent acknowledgement.

A refusal SHALL be reported as a file-browser error carrying the request id and a machine-readable
reason, reusing the existing set: `denied` outside the writable zone, `conflict` when the path
exists, `outside-root` for a path that escapes.

These messages SHALL NOT relax `write_file`. Its refusal of a path that is not already a file is
the guard against writing over something that moved, and creation is a separate intent with its own
message.

#### Scenario: CreateFileMessage
- **WHEN** a client sends `create_file` for a new path inside the writable zone
- **THEN** the file is created and the client receives the written-file answer with its size and mtime

#### Scenario: CreateDirectoryMessage
- **WHEN** a client sends `create_directory` for a new path inside the writable zone
- **THEN** the directory is created and the client is told so under the same request id

#### Scenario: CreateRefusedCarriesReason
- **WHEN** creation is refused because the path exists, is outside the writable zone, or escapes the root
- **THEN** the client receives a file-browser error under that request id with the matching reason

#### Scenario: WriteFileStillRefusesMissingPaths
- **WHEN** `write_file` names a path that does not exist
- **THEN** it is still refused as a conflict, as before
