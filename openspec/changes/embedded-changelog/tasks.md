## 1. Changelog

- [x] 1.1 `CHANGELOG.md` with sections from 0.41.0; GitHub Releases for older ones.
- [x] 1.2 Inlined by both builds.

## 2. Server

- [x] 2.1 `changelog.ts`: parse, sections between two versions, the version marker; tests.
- [x] 2.2 `outpostChanges` in the snapshot and `outpost_changes`; recorded before the update check.
- [x] 2.3 `releaseNotes` on the update notice.

## 3. UI

- [x] 3.1 `ChangesNotice`, dismissed per version; hidden in a widget.
- [x] 3.2 "What's new" link in `UpdateNotice`.

## 4. Release

- [x] 4.1 `scripts/changelog-section.mjs`; the workflow's gate and release notes; tests.
- [x] 4.2 `docs/development.md` § Releasing; README.

## 5. Verification

- [x] 5.1 Running app: the notice after an update, expanded, links, dismissal; monkey pass.
- [x] 5.2 `scenario-coverage.md`, `openspec validate --strict`, `check:scenarios`, lint, suites.
