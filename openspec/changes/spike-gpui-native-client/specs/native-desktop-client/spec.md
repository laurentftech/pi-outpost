# Spec Delta

## Purpose

Provides an experimental native desktop client for pi-outpost that connects to its existing server, allowing the project to evaluate a native conversation experience without replacing the server or web client.

## ADDED Requirements

### Requirement: NativeClientUsesTheExistingServerBoundary
The native client SHALL interact with the agent only through the existing pi-outpost server protocol. It SHALL NOT access the agent runtime, workspace filesystem, credentials, or server internals directly.

#### Scenario: NativeConversationUsesTheServer
- **WHEN** a user sends a prompt from the native client
- **THEN** the client sends it through the authenticated server connection and displays the server-streamed response

#### Scenario: ServerSecurityBoundaryRemainsAuthoritative
- **WHEN** the native client performs an operation requiring server authority
- **THEN** the server applies the same authentication, workspace binding, and security rules as it does for other clients

### Requirement: NativeClientProvidesASpikeConversationFlow
The experimental native client SHALL support connecting to a pi-outpost server, displaying the active conversation, sending a prompt, and displaying streamed assistant and tool activity sufficient to evaluate a vertical slice. It SHALL present connection and startup failures visibly and SHALL NOT claim full feature parity with the web client.

#### Scenario: ConnectAndSendPrompt
- **GIVEN** a reachable pi-outpost server and an available agent session
- **WHEN** the user opens the native client and sends a prompt
- **THEN** the existing conversation is shown and the streamed response appears in the native window

#### Scenario: ServerConnectionFails
- **GIVEN** the server cannot be reached or the connection is rejected
- **WHEN** the native client attempts to connect
- **THEN** the client presents an actionable connection failure rather than an empty or indefinitely loading conversation

### Requirement: NativeLauncherOwnsOnlyTheServerItStarts
When the dedicated native launch path starts a server for its client, it SHALL wait until the server is ready before opening the native window and SHALL stop that server when the client exits. It SHALL NOT stop a server that was already running and reused by the client.

#### Scenario: NativeLaunchStartsAndStopsItsServer
- **WHEN** the user launches the native client and no reusable server is running
- **THEN** the launcher starts the configured server, opens the native client only after readiness, and stops the server it started when the client exits

#### Scenario: ReusedServerOutlivesTheNativeClient
- **GIVEN** a server that was already running before native launch
- **WHEN** the user closes the native client
- **THEN** the server remains running
