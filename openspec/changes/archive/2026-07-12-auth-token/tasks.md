# Tasks: auth-token

## 1. Config

- [x] 1.1 Add `token?: string` to the server section of `AppConfig` in `server/src/config.ts` (non-empty string check, `[config]` error); apply `PI_OUTPOST_TOKEN` env override after file load
- [x] 1.2 Update `pi-outpost.config.example.json` and README security section (long random token guidance, `openssl rand -hex 32`)

## 2. Server enforcement

- [x] 2.1 Auth helper in `server/src/index.ts`: timing-safe token check via `crypto.timingSafeEqual` over SHA-256 digests
- [x] 2.2 WS: when a token is configured, verify `?token=` after the handshake; on failure close with code 4401 and send nothing (no snapshot)
- [x] 2.3 `/branding`: require `Authorization: Bearer <token>` (401 otherwise); `/health`: omit sessionId while auth is enabled
- [x] 2.4 WS test script: valid token connects + gets hello; missing/wrong token → close 4401 with no data; /branding 401 without header, 200 with; /health has no sessionId; no-token config unchanged (10/10 + 3/3 PASS)

## 3. Frontend flow

- [x] 3.1 Token bootstrap in `web/src/useAgent.ts` (or small module): read `?token=` → localStorage `pi-outpost:token` → strip URL; append token to WS URL and branding fetch when present; accept an explicit token prop (embed) taking precedence over localStorage
- [x] 3.2 Handle WS close 4401: stop the reconnect loop, set an `authRequired` state
- [x] 3.3 `TokenGate` component: full-page token input shown when `authRequired`; submit stores the token and reconnects; wire in `web/src/App.tsx`
- [x] 3.4 `embed/src/mount.tsx`: `token?: string` in `MountOptions`, forwarded to `App`

## 4. Verification

- [x] 4.1 Browser E2E: open with ?token= → connected and URL stripped; wrong stored token → token screen → paste correct token → connected; no-token server → no screen
- [x] 4.2 Typecheck + `npm run build --workspaces --if-present`
- [x] 4.3 Code review agent pass (auth-focused); fix blocking findings
