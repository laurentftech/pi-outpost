# Tasks

## 1. Bounded untracked listing

- [x] 1.1 Protocol: `GitFileStatus.atLeast`.
- [x] 1.2 `gitStatusFor`: `--untracked-files=normal`, bounded listing of each collapsed directory, one `atLeast` entry above the limit; server tests with a real repository (small new directory listed, large one collapsed).
- [x] 1.3 Tree badges `N+` and Outcome entry for a collapsed directory; UI tests.

## 2. Status sent as changes

- [x] 2.1 Protocol: request `base`, answer `version`, `base`, `removed`.
- [x] 2.2 Server: per-connection last-sent status and version; delta when the base matches, full otherwise; release on close; server tests (one change, a removal, a stranger version, a scoped answer).
- [x] 2.3 Client: send the held version, apply a delta only on a matching base, ask in full otherwise; reducer tests.

## 3. Verify

- [x] 3.1 Reproduce the slow case (a directory of 30,000 untracked files) and measure the status payload before and after: `-uall` porcelain 30,164 lines / 878 KB → one entry, full answer 162 entries / 25 KB; a refresh after one change 200–670 bytes. (The double-click cost came from the per-row badge scan, fixed separately in #493.)
- [x] 3.2 `scenario-coverage.md`, `npm run check:scenarios`, `openspec validate git-status-at-scale --strict`, server and UI suites, typecheck.
