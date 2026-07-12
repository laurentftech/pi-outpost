# Proposal: auth-token

## Why

pi-outpost has no authentication: safety rests entirely on binding to 127.0.0.1 and a WS
Origin allowlist. The stated goal is embedding it as a tab in a larger application (and
reaching it from other machines) — the moment the server binds beyond localhost, anyone who
can reach the port drives an agent that reads and writes files. A shared-secret token gates
that.

## What Changes

- Optional shared-secret token: `server.token` in the config, overridable by the
  `PI_OUTPOST_TOKEN` env variable (env wins, keeps the secret out of config files).
- When set, the WebSocket and the HTTP API (`/branding`) require the token; static assets
  stay public (the SPA shell is not sensitive), `/health` stays public but stops exposing
  the session id while auth is on.
- Browser flow: token accepted via `?token=…` in the URL (stored in localStorage, stripped
  from the address bar) or typed into a token screen shown when the server closes the socket
  with an auth-failure code.
- Embed widget: `mount(container, { token })` forwards the token.
- Token comparison is timing-safe; Origin allowlist keeps applying (defense in depth).
- Unset token = today's behavior, unchanged.

## Capabilities

### New Capabilities

- `auth`: optional shared-token authentication for the WebSocket and HTTP API, with the
  browser-side token acquisition/storage flow.

### Modified Capabilities

- `model`: `AppConfig` gains `server.token`; validation rules updated.
- `architecture`: SecurityModel requirement gains the token layer.

## Impact

- `server/src/config.ts` — `token` field + env override.
- `server/src/index.ts` — auth check on WS (close 4401 post-handshake so the client can
  react) and `/branding`; `/health` redaction.
- `web/src/useAgent.ts` — token in WS URL and branding fetch; 4401 handling.
- `web/src/App.tsx` + new `TokenGate` component — token screen; URL/localStorage handling.
- `embed/src/mount.tsx` — `token` option.
- No new dependencies (`crypto.timingSafeEqual`).
