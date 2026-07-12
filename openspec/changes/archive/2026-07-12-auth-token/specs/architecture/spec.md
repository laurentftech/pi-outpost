# Delta: architecture — auth-token

## MODIFIED Requirements

### Requirement: SecurityModel

The system SHALL implement security via network scoping, an optional shared token, and sandboxing:
- The server binds to 127.0.0.1 by default (`server.host` config to override deliberately)
- WebSocket upgrades are rejected unless the Origin is localhost/127.0.0.1 or an exact match in `server.allowedOrigins`
- When a token is configured (`server.token` / `PI_OUTPOST_TOKEN`), the WebSocket and the HTTP API additionally require it (timing-safe comparison); binding beyond localhost without a token is the operator's explicit choice
- When a sandbox is configured, built-in file tools are replaced by scoped ones confined to `sandbox.root` (writes further confined to `sandbox.writableRoot`, bash off by default)
- Session switching only accepts paths returned by the SessionManager listing (no arbitrary file paths)

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
