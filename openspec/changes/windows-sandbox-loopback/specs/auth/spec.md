# Spec Delta

## MODIFIED Requirements

### Requirement: OptionalSharedToken

The system SHALL require a shared-secret token on every listener, loopback included. It is `server.token`, overridden by `PI_OUTPOST_TOKEN` (env wins); empty tokens MUST be rejected at config load. When neither is set, the server SHALL generate a random token at first start, keep it in a file of the agent directory readable by its owner only, and reuse it on later starts.

#### Scenario: EnvOverridesConfig
- **WHEN** both server.token and PI_OUTPOST_TOKEN are set
- **THEN** the environment variable's value is the effective token

#### Scenario: NoTokenConfigured
- **GIVEN** neither server.token nor PI_OUTPOST_TOKEN set, on a literal loopback listener
- **WHEN** the server starts twice
- **THEN** both starts require the same generated token, kept in the agent directory
- **AND** a WebSocket connection without it closes with code 4401

#### Scenario: GeneratedTokenOutOfTheSandbox
- **GIVEN** a generated token and the agent's shell confined by any sandbox runner
- **WHEN** a command lists its environment and reads the token's file
- **THEN** the token appears in neither

### Requirement: ProtectedSurfaces

The system SHALL require the token on the WebSocket (via `?token=` query parameter or `Authorization:
Bearer`) and on `/branding` (via `Authorization: Bearer`), comparing timing-safely, whatever the
client's `Origin` — a client sending none is not trusted for being local. Static assets stay public;
`/health` stays public but MUST NOT expose the session id. The WS handshake completes before an auth
failure closes the socket with code 4401, so the client can distinguish bad credentials from an
unreachable server.

#### Scenario: WsWithValidToken
- **WHEN** a WS connection includes the correct ?token=
- **THEN** The connection proceeds normally (Origin allowlist still applies)

#### Scenario: WsWithBadToken
- **WHEN** a WS connection has a missing or wrong token
- **THEN** The handshake completes and the socket closes immediately with code 4401
- **AND** no snapshot or agent data is sent

#### Scenario: WsWithoutOriginNeedsTheToken
- **GIVEN** a loopback server with no configured token
- **WHEN** a native client connects to the WebSocket without an Origin header and without the token
- **THEN** the socket closes with code 4401 and no agent data is sent

#### Scenario: BrandingRequiresBearer
- **WHEN** GET /branding lacks a valid Authorization: Bearer header
- **THEN** 401 is returned

#### Scenario: HealthRedacted
- **WHEN** GET /health is called
- **THEN** 200 with ok status but without the session id

## ADDED Requirements

### Requirement: StartupUrlCarriesTheToken

When the token was generated, the URL the server prints at startup, and the one it opens in a browser,
SHALL carry it as `?token=`, so the operator reaches the interface without typing it. A token the operator
configured SHALL NOT be printed.

#### Scenario: OpenedBrowserIsAuthenticated
- **GIVEN** a loopback server with a generated token that opens the interface in a browser
- **WHEN** the page loads from the opened URL
- **THEN** the interface connects without showing the token screen, and the address bar no longer shows the token

#### Scenario: AConfiguredTokenIsNeverPrinted
- **GIVEN** a server started with `server.token` set
- **WHEN** it prints its startup line
- **THEN** the address has no `token` parameter and the token appears nowhere in its output
