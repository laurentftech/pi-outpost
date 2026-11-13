# Adopt npm 12 installation security

## Why
Publishing already uses OIDC, but dependency installation still relies on npm 11 defaults.
Fresh npm 12 consumer installs can finish successfully while leaving the native terminal unbuilt.

## What Changes
- Pin npm 12.2.1 for contributors, CI, Docker builds and release packaging.
- Review and explicitly allow or deny dependency lifecycle scripts; fail on unreviewed repository scripts.
- Authorize only the terminal and native sandbox script identities for global/npx installs and global updates.
- Exercise real fresh global/npx installs and native PTYs on Linux, Windows and macOS, including denied lifecycle code.

## Impact
Installation instructions, team installers, CLI repair/update advice and automation. OIDC publishing stays in place.
Registry dependencies need no Git/remote exceptions. Extension-native scripts require a separate operator review.
