## 1. Server

- [x] 1.1 `GitCommitLogEntry` in `shared`; `git_log` carries it.
- [x] 1.2 `gitLog`: HEAD and local branches, rewritten and pruned parents, branch names, HEAD marker; tests.

## 2. UI

- [x] 2.1 Move the lane sweep to `graph/commitGraph.ts`; `fileGraph.ts` calls it.
- [x] 2.2 `layoutCommitGraph` with lane 0 reserved for HEAD; tests.
- [x] 2.3 `GitMenu` draws the rail and branch names; tests.

## 3. Verification

- [x] 3.1 Running app: the map on a repository with branches and merges; monkey pass.
- [x] 3.2 `scenario-coverage.md`, `openspec validate --strict`, `check:scenarios`, typecheck, lint, suites.
