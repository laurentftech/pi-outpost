# Design: auth-token

## Context

Security today: 127.0.0.1 bind by default, WS Origin allowlist, sandbox confinement. No
authentication anywhere. `server.allowedOrigins` already exists for embedding; `server.host`
lets a deployment bind wider — which is exactly when a credential becomes mandatory. pi-web
(the closest sibling project) ships `PI_WEB_TOKEN` bearer auth for the same reason.

## Goals / Non-Goals

**Goals:**
- Single shared secret gating the WS and the HTTP API when configured.
- Ergonomic browser hand-off: paste a URL containing the token once, never see it again.
- Zero behavior change when no token is configured.
- Embed-friendly: host app supplies the token programmatically.

**Non-Goals:**
- No users/roles/sessions, no OAuth/OIDC, no token rotation or expiry (single-operator tool).
- No TLS termination (deploy behind a reverse proxy / Tailscale for transport security).
- No rate limiting / brute-force lockout in v1 (timing-safe compare + long random tokens).

## Decisions

1. **Source of truth: `server.token` config field, `PI_OUTPOST_TOKEN` env wins.** Env
   override keeps secrets out of committed config files and matches the existing
   `PI_OUTPOST_CONFIG` convention. Empty-string token is a config error (fail at load).

2. **What is protected**: the WS upgrade (all agent capability flows through it) and
   `/branding`. Static assets remain public — the compiled SPA contains no secrets, and
   serving it lets the token screen render at all. `/health` remains public for probes but
   returns `{ok: true}` only (no session id) when auth is enabled.

3. **WS auth completes the handshake, then closes with code 4401.** Rejecting the upgrade
   pre-handshake surfaces as an opaque 1006 in browsers — the client couldn't distinguish
   "bad token" from "server down" and would retry forever. Accepting then immediately
   closing with a custom code (4401, reserved app range) gives the client a precise signal
   to show the token screen instead of the reconnect loop.

4. **Token transport**: WS uses a `?token=` query parameter (browsers cannot set headers on
   WebSocket); `/branding` accepts `Authorization: Bearer <token>`. The query parameter is
   not logged by the server (no request-URL logging exists) and is stripped from the
   browser's address bar immediately.

5. **Browser acquisition/storage**: on boot the client reads `?token=` from the page URL →
   saves to `localStorage["pi-outpost:token"]` → `history.replaceState` removes it from the
   URL. On WS close 4401 it clears state and renders a token screen (input + connect
   button); submitted tokens go to localStorage and trigger a reconnect. This is the
   pi-web/Jupyter-style flow.

6. **Comparison**: `crypto.timingSafeEqual` over SHA-256 digests of both sides (digesting
   first sidesteps the equal-length requirement without leaking length via early return).

7. **Embed**: `MountOptions.token` → `App` prop → appended to the WS URL and branding fetch.
   Hosts that already authenticated their own user just inject the token server-side.

## Risks / Trade-offs

- [Token in localStorage is readable by any XSS in the app] → the app renders markdown via
  React (no dangerouslySetInnerHTML paths); accepted for a single-operator tool.
- [Query param may appear in intermediary logs when deployed behind a proxy] → documented;
  header transport used everywhere a header is possible.
- [No lockout: token is brute-forceable if short] → document "use a long random token"
  (e.g. `openssl rand -hex 32`); timing-safe compare removes the oracle.
- [Origin allowlist and token overlap] → kept both: Origin stops drive-by browser CSRF-style
  connections even when the token leaks into a URL shared carelessly.

## Migration Plan

Additive and opt-in: without `server.token`/`PI_OUTPOST_TOKEN` nothing changes. Rollback =
unset the token.

## Open Questions

- None blocking.
