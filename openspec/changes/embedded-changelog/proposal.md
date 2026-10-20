# What changed, after an update — from a changelog that ships with pi-outpost

## Why

The notice of a newer version says a number and a command, nothing about what the new
version does. And once updated, nothing says anything at all: the release notes exist only
on GitHub, generated from PR titles at release time, and an installation that checks for
nothing, or runs offline, never meets them. pi solves the same problem by shipping its
`CHANGELOG.md` and showing the sections newer than the last version it ran.

## What Changes

- A hand-written `CHANGELOG.md` at the repository root, one `## [X.Y.Z] - date` section
  per release, written for the person who just updated.
- Both builds (the npm bundle and the executable's) inline it, like the version.
- The server remembers the last version that ran (`<agentDir>/outpost-version.json`). After
  an update it sends the sections between that version and the running one; the standalone
  interface shows "pi-outpost was updated to X (from Y)" with **What's changed**, dismissed
  per version in each browser. An installation older than the marker is told about the
  running release only, recognised by the update check's cache. `changelogNotice: false`
  turns the news off; the version is still recorded.
- The notice of a newer version links that version's GitHub Release.
- The release workflow refuses a tag whose version has no section, and publishes the section
  as the GitHub Release's notes, ahead of GitHub's generated list. `test:scripts` fails while
  the packages' version has no section, so a bump cannot land without one.

## Impact

- `CHANGELOG.md`; `docs/development.md` § Releasing gains the step; `README.md`.
- `shared`: `OutpostChangelogEntry`, `OutpostChanges`; `outpostChanges` in the snapshot;
  `outpost_changes`; `OutpostUpdateNotice.releaseNotes`.
- `server`: `changelog.ts`; the `changelogNotice` key in `config.ts`; `releaseNotesUrl` in `update.ts`; startup records the version
  before the update check runs. `cli/scripts/build.mjs`, `server/scripts/build-sea.mjs`.
- `ui`: `ChangesNotice`; a link in `UpdateNotice`.
- `scripts/changelog-section.mjs`; `.github/workflows/release.yml`.
