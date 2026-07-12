# Auth Specification

## ADDED Requirements

### Requirement: OptionalSharedToken

The system SHALL support an optional shared-secret token, configured as `server.token` and
overridden by the `PI_OUTPOST_TOKEN` environment variable (env wins). An empty-string token
MUST be rejected at config load. Without a token, behavior is unchanged (no authentication).

#### Scenario: EnvOverridesConfig
- **WHEN** both server.token and PI_OUTPOST_TOKEN are set
- **THEN** The environment variable's value is the effective token

#### Scenario: NoTokenConfigured
- **WHEN** neither server.token nor PI_OUTPOST_TOKEN is set
- **THEN** All endpoints behave exactly as before (no credential required)

### Requirement: ProtectedSurfaces

When a token is configured, the system SHALL require it on the WebSocket (via `?token=`
query parameter) and on `/branding` (via `Authorization: Bearer`), comparing timing-safely.
Static assets stay public; `/health` stays public but MUST NOT expose the session id while
auth is enabled. The WS handshake completes before an auth failure closes the socket with
code 4401, so the client can distinguish bad credentials from an unreachable server.

#### Scenario: WsWithValidToken
- **WHEN** a WS connection includes the correct ?token=
- **THEN** The connection proceeds normally (Origin allowlist still applies)

#### Scenario: WsWithBadToken
- **WHEN** a WS connection has a missing or wrong token
- **THEN** The handshake completes and the socket closes immediately with code 4401
- **AND** no snapshot or agent data is sent

#### Scenario: BrandingRequiresBearer
- **WHEN** GET /branding lacks a valid Authorization: Bearer header
- **THEN** 401 is returned

#### Scenario: HealthRedacted
- **WHEN** GET /health is called while auth is enabled
- **THEN** 200 with ok status but without the session id

### Requirement: BrowserTokenFlow

The frontend SHALL accept the token from a `?token=` URL parameter (persisting it to
localStorage and stripping it from the address bar), reuse the stored token on later visits,
and on a 4401 close SHALL stop reconnecting and show a token screen whose submission stores
the token and reconnects.

#### Scenario: TokenInUrl
- **WHEN** the app loads with ?token=… in the URL
- **THEN** The token is stored, removed from the address bar, and used for the WS connection

#### Scenario: BadStoredToken
- **WHEN** the WS closes with code 4401
- **THEN** The reconnect loop stops and a token input screen is shown
- **AND** submitting a token stores it and reconnects

#### Scenario: EmbedToken
- **WHEN** the embed widget is mounted with a token option
- **THEN** That token is used for the WS and branding requests (no token screen involved)
