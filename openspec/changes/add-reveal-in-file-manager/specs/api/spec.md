## ADDED Requirements

### Requirement: RevealNativeMessage

The WebSocket protocol SHALL carry a correlated `reveal_native` client message with a request id and
a browser-root-relative path. Success SHALL be acknowledged as a `file_operation_result` with the
operation `reveal_native` under the request id; a refusal or a file manager that cannot be started
SHALL be reported as a file-browser error under the same request id.

#### Scenario: RevealIsAcknowledgedOrRefusedUnderItsRequestId
- **WHEN** a client sends `reveal_native` for an existing path, then for a missing one
- **THEN** the first is answered with a `file_operation_result` for `reveal_native`, and the second with a `file_browser_error`, each under its own request id
