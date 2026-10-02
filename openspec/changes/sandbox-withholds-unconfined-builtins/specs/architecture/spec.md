## MODIFIED Requirements

### Requirement: SecurityModel

The system SHALL implement security via network scoping, an optional shared token, and sandboxing:
- The server binds to 127.0.0.1 by default (`server.host` config to override deliberately)
- WebSocket upgrades are rejected unless the Origin is localhost/127.0.0.1 or an exact match in `server.allowedOrigins`
- When a token is configured (`server.token` / `PI_OUTPOST_TOKEN`), the WebSocket and the HTTP API additionally require it (timing-safe comparison); binding beyond localhost without a token is the operator's explicit choice
- When a sandbox is configured, built-in file tools are replaced by scoped ones confined to `sandbox.root` (writes further confined to `sandbox.writableRoot`, bash off by default). Pi's own built-in tools that the sandbox does not replace are not registered in the session at all, so neither an extension nor a setting can activate an unconfined one; a sandboxed session that would still register one fails to start. A sandbox is scoped to the workspace it belongs to: a workspace's tools are confined to that workspace's root, never to another workspace's
- A client may open a workspace at any server-side path it can reach through the directory picker, exactly as it may already move the sandbox root there; the boundary is the configured lock, not an enumeration of allowed roots. A workspace opened this way is sandboxed at its own root like any other
- Session switching only accepts paths returned by the SessionManager listing (no arbitrary file paths), and only from the session manager of the workspace the connection is bound to

#### Scenario: CrossOriginRejected
- **GIVEN** a WebSocket upgrade with an Origin not in the allowlist
- **WHEN** the connection is attempted
- **THEN** the server rejects the upgrade

#### Scenario: TokenRequired
- **GIVEN** a configured token
- **WHEN** a WebSocket connects without it (or /branding is fetched without the bearer header)
- **THEN** the connection is closed with an auth-failure code (or 401 returned) before any agent data flows

#### Scenario: SandboxedFileAccess
- **GIVEN** a configured sandbox root
- **WHEN** an agent tool tries to read or write outside that root (including via symlinks)
- **THEN** the tool call fails with an error

#### Scenario: UnconfinedBuiltInsAreNotRegistered
- **GIVEN** a sandbox that withholds a tool Pi has built in (`bash` without `allowBash`, `write` and `edit` in a read-only sandbox)
- **WHEN** an extension asks the session to activate that tool
- **THEN** the tool is neither active nor registered, and the sandbox's own confined tools are unaffected

#### Scenario: OpeningAWorkspaceUnderALock
- **GIVEN** a configuration that forbids opening projects
- **WHEN** a client asks to open a directory as a workspace
- **THEN** it is refused, and no session or sandbox is created for that path

#### Scenario: ANewWorkspaceIsSandboxedAtItsOwnRoot
- **GIVEN** a sandboxed server
- **WHEN** a client opens a directory as a new workspace
- **THEN** that workspace's tools are confined to that directory, not to the one the server started in

#### Scenario: SessionsCannotBeOpenedAcrossWorkspaces
- **GIVEN** a connection bound to workspace A
- **WHEN** it asks to open a session file belonging to workspace B
- **THEN** the request is refused
