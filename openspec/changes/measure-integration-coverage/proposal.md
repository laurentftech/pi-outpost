# Proposal

## Why

The server's coverage figure leaves out the code that matters most. The 101 integration
suites (`server/test/*.test.mjs`) drive a real server in a subprocess, and that subprocess's
coverage is deliberately switched off: when node's own test reporter read the children's
coverage files (about 20 MB each, mostly pdf.js source maps), it truncated its report at
10 MB and the run failed. So `src/index.ts` (7,771 lines) and `src/embeddedRuntime.ts` are
excluded, files no test loads never appear, and the badge describes the unit suites only.
OpenSSF silver and gold ask for statement and branch coverage of the project, which that
figure cannot support.

A spike (branch `spike/coverage`, workflow run 42474889512, Ubuntu) measured the alternative:
with the servers writing their own coverage on a clean exit, cut down to `server/src` and
merged by c8 over the full inventory, the server reaches **94.9% of lines and statements,
86.5% of branches and 97.2% of functions**, with `index.ts` at 88.9%. The instrumented run
took 18 min 43 s, in place of today's two Ubuntu server steps (11 min of tests, then 4 min of
coverage), while the Windows job (27 min) remains the longest in CI.

## What Changes

- The server's coverage covers the integration suites too: on the Ubuntu CI leg, the servers
  the test harness starts write V8 coverage when they exit, and the run merges it with the
  unit suites' coverage.
- The figure is computed over an explicit inventory: every file under `server/src` counts,
  a file no test loads counting as 0%. The few exclusions (generated code, the bundled
  reference validator, type declarations) are listed in one place with their reason.
- Each child's coverage is cut down to `server/src` as soon as the child stops, so the raw
  files (about 20 MB per process) never accumulate and node's test reporter never reads
  them.
- In coverage mode only, the harness gives a stopping server time to exit cleanly before
  killing it, so it can write its coverage.
- One instrumented run replaces the Ubuntu `npm test --workspace server` and
  `npm run test:coverage --workspace server` steps. Windows keeps its uninstrumented run.
- The CI summary publishes covered/total counts for lines, statements, branches and
  functions, with the exclusion list, instead of a headline that sets `index.ts` aside.
- **BREAKING (reporting)**: the server figure behind the coverage badge and the server
  thresholds change meaning, from "unit suites, `index.ts` excluded" to "all suites, full
  inventory". The thresholds are reset from the measured values (see design).
- The test that guards against coverage leaking into children (`children launched by the
  server tests`) is adapted: the server child may now write coverage, but only into the
  run's coverage directory and only when coverage mode asks for it; the agent and terminal
  children the server starts still never inherit it.

## Capabilities

### New Capabilities

- `test-coverage`: how the project measures and reports test coverage — which suites and
  processes contribute, the inventory the percentages are computed over, the exclusions,
  the thresholds that fail CI, and what the badge claims.

### Modified Capabilities

None. No existing capability specifies coverage measurement.

## Impact

- **Code**: `server/test/harness.mjs` (coverage mode, longer stop grace, per-child
  filtering), a new script that filters and merges coverage, `server/package.json`
  (`test:coverage`), `scripts/coverage-summary.mjs` and `scripts/coverage-badge.mjs`
  (drop the `index.ts` special case, report the inventory), `.github/workflows/ci.yml`
  (one instrumented Ubuntu step).
- **Tests**: the coverage-guard test in `server/test/pi-rpc.test.ts` and any test asserting
  the old exclusions; a new test of the filter.
- **Dependencies**: `c8` as a dev dependency of the server workspace, to merge V8 coverage
  and map it through tsx's source maps. It has no install scripts.
- **CI time**: Ubuntu `check` job about 4 min longer in the spike; the run's wall time is
  bounded by the Windows job and should move by about a minute at most.
- **Docs**: `docs/quality.md` (what the badge means, thresholds), `docs/development.md`
  (tests and coverage), `docs/openssf.md` (coverage action).
- **Unchanged**: UI coverage (Vitest), Windows and macOS legs, the product itself.
