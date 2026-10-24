# Proposal

## Why

Open WebUI users can retouch a poster in the embedded editor, but those edits currently stay in the browser. The model therefore reads an older revision, and users cannot continue working from the version they just corrected.

## What Changes

- Add a browser-reachable, narrowly scoped save path for poster edits. It must not expose the Open WebUI bearer secret.
- Save touch-ups as normal owner-scoped poster revisions with stale-revision protection, so the model reads the user's latest saved version.
- Explain the required Docker URL/network configuration and the existing privacy boundary: accounts are isolated by signed Open WebUI identity, while volume files are not encrypted at rest.

## Capabilities

### New Capabilities
- `openwebui-posters`: Save embed edits as owner-scoped revisions that the model can subsequently read.

### Modified Capabilities

## Impact

Open WebUI poster embed, poster store and routes, server configuration, Docker Compose deployment, user documentation, unit tests, and running-app Playwright coverage.
