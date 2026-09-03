## ADDED Requirements

### Requirement: Terminal multiplexed over WebSocket protocol

The typed protocol SHALL multiplex interactive pseudo-terminal sessions over the existing authenticated WebSocket connection.

#### Scenario: Opening a terminal
- **GIVEN** an authenticated WebSocket connection and a server configured with `terminal.enabled: true`
- **WHEN** the client sends `terminal_open` with a `terminalId` and optional `cwd`, `cols`, `rows`
- **THEN** the server spawns a pseudo-terminal for that socket
- **AND** streams output chunks via `terminal_data`
- **AND** emits `terminal_exit` when the shell process exits

#### Scenario: Server rejects terminal when disabled
- **GIVEN** an authenticated WebSocket connection on a server where `terminal.enabled` is `false` or `sandbox.allowBash` is `false`
- **WHEN** the client sends `terminal_open`
- **THEN** the server responds with a `terminal_error` message and does not spawn a process

### Requirement: Per-socket terminal session isolation

All terminal operations SHALL be scoped to the socket connection that created the terminal session.

#### Scenario: Cross-socket access is refused
- **GIVEN** client A has opened a terminal with ID `term-1`
- **WHEN** client B sends `terminal_input`, `terminal_resize`, `terminal_get_cwd`, or `terminal_close` targeting `term-1`
- **THEN** the server refuses or ignores the message without affecting client A's terminal session

### Requirement: Session snapshot carries terminal availability

The `SessionSnapshot` message SHALL carry `terminal: { enabled: boolean, locked?: boolean }` describing whether the terminal feature is enabled and whether runtime changes are locked.

#### Scenario: Session snapshot reports terminal settings
- **GIVEN** a server configured with terminal settings and sandbox locks
- **WHEN** a client connects and receives the initial session snapshot
- **THEN** the snapshot carries `terminal: { enabled: boolean, locked?: boolean }`
