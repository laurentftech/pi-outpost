# Tasks

## 1. Scoped save capability

- [x] 1.1 Add optional validated `OUTPOST_PUBLIC_URL` and `OUTPOST_WEBUI_ORIGIN` settings; absent values preserve the current no-network/read-only embed. Add Docker Compose variables and port publishing with setup docs.
- [x] 1.2 Issue and verify HMAC save capabilities bound to owner, poster id, base revision, and expiry; test malformed, tampered, expired, wrong-poster, and wrong-revision tickets.
- [x] 1.3 Add the CORS-constrained save route, validating exact origin and content before calling `PosterStore.revise`; test invalid origin/capability, cross-user isolation, conflict, and unchanged data on refusal.

## 2. Embed and model flow

- [x] 2.1 Wire the shared editor save adapter to the scoped route; update the in-memory revision and ticket after success, preserve dirty state on failure, and limit the embed CSP to the configured endpoint origin.
- [x] 2.2 Update tool descriptions and user docs so `get_poster` returns saved retouches, stale embeds are explained, and Open WebUI/ pi-outpost volume data is described accurately as owner-isolated but unencrypted at rest.
- [x] 2.3 Cover save and readback, repeated save, expired/stale embed, and an unrelated origin in `e2e/openwebui-posters.spec.ts`; run it against the running browser app, including a rapid/double-click failure pass.

## 3. Completion checks

- [x] 3.1 Enumerate this delta's scenarios and provide the scenario-to-test matrix; run focused tests, relevant suites, and `openspec validate --strict`.
- [x] 3.2 Review the complete diff, resolve critical/high review findings, and record documentation impact before updating the pull request.
