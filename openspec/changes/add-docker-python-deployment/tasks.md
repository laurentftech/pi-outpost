## Implementation
- [x] Add Dockerfile, Compose, default config and protected-token bootstrap.
- [x] Document setup, persistence, confinement and network limitations.
- [x] Build the image and run its real integration checks.
- [x] Exercise Python and terminal lifecycle in the running app with Playwright.
- [x] Validate scenario coverage, links and OpenSpec strictly.

## Release publication follow-up
- [x] Pass the built CLI tarball to a separate gated full-app image release job.
- [x] Reuse release channel tags and keep internal artifacts off release attachments.
- [x] Test the default non-root distributable image with private fixture ownership.
- [x] Document published-image use, platforms, UID mapping and release verification.
- [ ] Confirm the updated exact-image integration checks in CI.
- [ ] Verify first actual release publication and anonymous GHCR access after merge.
