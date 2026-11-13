# Scenario coverage

Inventory: `rg '^#### Scenario:' openspec/` was run, then the affected main auth and
architecture specifications and both delta specifications were read. OpenLore returned
`no-analysis`; targeted source/test inspection was used instead. Assertions were read,
including socket close codes and the absence of pre-authentication application data.

| Scenario | Status | Test file and name / assertion evidence |
|---|---|---|
| LocalHttp | covered | `server/test/serverTransport.test.ts`: `LocalHttp` checks every accepted loopback spelling; `server/test/auth.test.mjs`: `a server without a token behaves as before` exercises real HTTP/WS; `server/test/cors.test.mjs`: `a local development origin passes with an empty allowlist`. |
| RemoteHttpRefused | covered | `server/test/serverTransport.test.ts`: `RemoteHttpRefused` checks wildcard, IPv6, IP and DNS hosts; `server/test/serverTransport.test.mjs`: `RemoteHttpRefused before any HTTP listener exists` requires unsuccessful real-process startup and actionable diagnostic. |
| ProtectedHopOptIn | covered | `server/test/serverTransport.test.mjs`: `ProtectedHopOptIn` observes the warning, HTTP 401 despite forwarded HTTPS, and authenticated WS hello. |
| RemoteStillRequiresToken | covered | `server/test/serverTransport.test.ts`: `RemoteStillRequiresToken` rejects both TLS and plaintext exceptions without a token through production config loading. |
| EnvironmentPolicyOverride | covered | `server/test/serverTransport.test.ts`: `EnvironmentPolicyOverride` checks both directions of policy precedence, cwd-relative TLS overrides and strict invalid-value refusal. |
| TlsFilesResolveAgainstConfig | covered | `server/test/serverTransport.test.ts`: `TlsFilesResolveAgainstConfig` uses a separate temporary config directory and checks both resolved paths. |
| IncompleteTlsRejected | covered | `server/test/serverTransport.test.ts`: `IncompleteTlsRejected` checks missing, empty and wrong-type fields and the named diagnostic. |
| HttpsAndWss | covered | `server/test/serverTransport.test.mjs`: `HttpsAndWss` uses trusted HTTPS and WSS, checks session hello, bearer checks, unauthorized close 4401 with no data, forbidden Origin close 1008, negotiated TLS version, TLS 1.1 refusal, untrusted CA and wrong-hostname refusal, and HTTPS announcement. |
| InvalidTlsFailsClosed | covered | `server/test/serverTransport.test.ts`: `InvalidTlsFailsClosed` covers missing, malformed, mismatched, expired and future material with redacted errors; `server/test/serverTransport.test.mjs`: `InvalidTlsFailsClosed at startup even when HTTP was explicitly allowed` checks real startup failures, no private key and no HTTP announcement. |
| NoPlaintextFallback | covered | `server/test/serverTransport.test.mjs`: `NoPlaintextFallback` sends HTTP with a token to the TLS port and requires failure with no application response. |
| HttpsBrowserAndReconnect | covered | `e2e/secure-transport.spec.ts`: `HttpsBrowserAndReconnect` opens the built app, reads connected DOM and workspace files, requires WSS, cuts real TCP connections, checks disconnected state and disabled composer, restores and checks draft/connection, reloads and recovers from wrong credentials through the form. `server/test/serverTransport.test.ts`: `Native TLS enforces a TLS 1.2 floor and HTTPS browser URLs` checks browser-launch scheme. |
| LocalPrintWithTlsConfiguration | covered | `server/test/printMode.test.mjs`: `LocalPrintWithTlsConfiguration` executes the real CLI/provider, requires exit 0 and answer on stdout, and verifies the ephemeral listener is loopback HTTP. |
| EnvOverridesConfig | covered | `server/test/serverTransport.test.ts`: `EnvOverridesConfig` loads file and environment tokens together and checks the effective token. Applies to main and delta auth. |
| NoTokenConfigured | covered | `server/test/auth.test.mjs`: `a server without a token behaves as before` verifies real local WS and public branding/health; CORS confinement remains asserted in `server/test/cors.test.mjs`: `path confinement is unchanged`. Applies to main auth narrowed by the delta. |
| WsWithValidToken | covered | `server/test/auth.test.mjs`: `a valid token connects and gets the snapshot`; TLS equivalent in `server/test/serverTransport.test.mjs`: `HttpsAndWss`, including forbidden Origin. |
| WsWithBadToken | covered | `server/test/auth.test.mjs`: `a missing or wrong token is closed with 4401 and gets no data`; equivalent assertions over WSS in `server/test/serverTransport.test.mjs`. |
| BrandingRequiresBearer | covered | `server/test/auth.test.mjs`: `/branding needs a Bearer token; /health hides the session id`; TLS equivalent in `server/test/serverTransport.test.mjs`: `HttpsAndWss`. |
| HealthRedacted | covered | `server/test/serverTransport.test.mjs`: `HttpsAndWss` checks 200 and absent session ID over TLS; `server/test/auth.test.mjs` checks HTTP. |
| TokenInUrl | covered | `e2e/secure-transport.spec.ts`: `HttpsBrowserAndReconnect` checks URL stripping, authenticated WSS and successful reload without a query token. |
| BadStoredToken | covered | `e2e/secure-transport.spec.ts`: `HttpsBrowserAndReconnect` checks visible access-token form, submission and successful authenticated reload; `ui/src/useAgent.test.ts`: `shows authRequired when closed with code 4401` and `submitToken stores the token and triggers reconnection` check client state. |
| EmbedToken | covered | `e2e/embed.spec.ts`: `a token-protected backend works across origins, preflight and all` passes the explicit widget token, observes backend branding and connected composer with no token screen. |
| CrossOriginRejected | covered | `server/test/serverTransport.test.mjs`: `HttpsAndWss` requires forbidden-origin policy close and no application data before rejection. |
| TokenRequired | covered | `server/test/serverTransport.test.mjs`: `HttpsAndWss` checks missing/wrong token, close 4401, no agent data and branding 401. |

The architecture main-spec edit corrects stale token/transport prose; its sandbox,
workspace and runtime scenarios are unaffected. Separate Open WebUI and outbound
provider transport are explicitly outside this change. No route inventory is added:
the existing `server/test/cors-route-inventory.test.mjs` compares production Fastify
registrations against the route test inventory and passes alongside the CORS suite.

`server/test/config-cli.test.mjs`: `TLS config output names paths without private key bytes`
also verifies the real diagnostic command exposes only TLS paths.

Validation ran on Windows with Node 26.4.0 and pinned npm 12.2.2. The built app was
exercised in Chromium; CA/hostname verification is checked separately by real Node TLS
clients, while the browser uses trust scoped to its disposable self-signed test context.
