# Design

## Context

The Open WebUI poster embed is a self-contained `srcdoc` page with `connect-src 'none'`. Open WebUI calls pi-outpost from its backend with a bearer secret and a signed user identity, but the user's browser cannot reach the container-only tool server. The existing poster store already isolates owners and appends immutable revisions guarded by `base_revision`.

## Decisions

1. Add optional `OUTPOST_PUBLIC_URL` and `OUTPOST_WEBUI_ORIGIN` settings. The public URL is the browser-reachable pi-outpost base URL; the WebUI origin is the exact browser origin allowed to save. When either is unset, the embed remains read-only as today. The Docker example publishes pi-outpost's port and documents LAN binding and HTTPS reverse-proxy requirements.
2. When serving `show_poster`, issue a signed capability for `(owner, poster id, base revision, expiry)`. Sign with an HMAC derived from the existing server secret. The embed receives only this scoped write capability, never the tool bearer key or identity signing key.
3. Add one public save route that bypasses the tool bearer/user-header hook only for this operation. It verifies the exact `Origin`, ticket signature, expiry and poster id/revision; validates poster content; then calls the existing owner-scoped `revise`. It returns the new revision and a replacement capability for that revision so the same open editor can save again.
4. The embed permits `connect-src` only to the configured pi-outpost origin and sends a CORS simple request without credentials. The endpoint returns CORS headers only for the configured WebUI origin. No wildcard CORS, cookies, redirects, or general read route are added.
5. Reopening an old conversation after its capability's revision has been consumed yields a conflict. The user can ask the model to show the latest revision again. Existing immutable history and stale-write behavior remain authoritative.
6. Storage remains plain JSON. User separation is enforced by signed Open WebUI identity and owner-scoped paths; volume access and backups remain trusted administrative boundaries. At-rest encryption is a separate migration requiring key management and recovery policy, so this change documents rather than silently invents that policy.

## Risks and mitigations

- Publishing the service port makes its existing bearer-protected tool routes network-reachable. Keep `OUTPOST_SECRET` high entropy; the public capability route accepts only scoped HMAC tickets and exact-origin browser requests.
- A capability is a bearer credential stored with the Open WebUI message. Scope it to one poster and one base revision, expire it, and rotate it after each successful revision.
- Cross-origin HTTP saves from an HTTPS Open WebUI origin are blocked as mixed content. Production HTTPS deployments must publish pi-outpost over HTTPS through a reverse proxy.
- A stale historical embed cannot overwrite newer content; it receives a conflict and must be refreshed through `show_poster`.

## Verification

Cover ticket signatures, owner/poster/revision scope, expiry, origin rejection, stale revisions, repeated saves with rotated tickets, and the existing cross-user access boundary in server tests. Exercise saving, model readback, stale embeds, and origin failures in the running Open WebUI browser with Playwright.
