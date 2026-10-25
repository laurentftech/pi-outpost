## 1. Gutter

- [x] 1.1 Line diff and revert (`ui/src/components/gitGutter.ts`), with unit tests.
- [x] 1.2 The editor's `baseline`: marks, peek, revert; read-only view without revert.
- [x] 1.3 `gitBaseline` in `useAgent`: asked per status, latest answer only, cleared when clean, untracked or refused.
- [x] 1.4 Styles, light and dark.

## 2. Git state changed outside

- [x] 2.1 `gitDirOf`; a watcher per repository's git directory, coalesced; owned by the workspace.
- [x] 2.2 `git_changed { repo }` from every workspace kind; the client re-reads that repository's status.

## 3. Coverage margin

- [x] 3.1 Win back the UI suite's function-coverage margin over its 93% threshold.

## 4. Verification

- [x] 4.1 Running app: marks, peek, revert, typing; monkey pass.
- [x] 4.2 `scenario-coverage.md`, `openspec validate --strict`, `check:scenarios`, typecheck, lint, suites.
