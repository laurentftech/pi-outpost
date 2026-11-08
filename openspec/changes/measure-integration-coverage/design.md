# Design

## Context

See proposal.md for the motivation. The current state that shapes the approach:

- `npm run test:coverage --workspace server` runs `node --test --experimental-test-coverage`
  over `test/*.test.ts` only, excluding `src/index.ts`, `src/embeddedRuntime.ts`,
  generated code and the bundled validator. Thresholds: lines 92, branches 86, functions 90.
- The harness (`server/test/harness.mjs`) starts each server with
  `node --import=tsx/esm`, in its own process group, and stops it with SIGTERM, then
  SIGKILL after 300 ms (on Windows `taskkill /T /F` straight away). It sets
  `NODE_V8_COVERAGE: ""` for the child; `childEnv.mjs` and the server's own spawners
  (`piRpcProcess.ts`, `terminalManager.ts`, `update.ts`) blank it the same way.
- `server/test/testChildEnvironment.test.ts` scans every test file for child launches and
  fails on any that does not name `NODE_V8_COVERAGE`. It recognises a few literal forms.
- The server handles SIGTERM by stopping its workspaces, closing Fastify and calling
  `process.exit(0)`, so on Linux a server given time to stop writes its V8 coverage.
- `scripts/coverage-summary.mjs` reports `src/index.ts` apart (`SUBPROCESS_ONLY`), and
  `scripts/coverage-badge.mjs` computes the badge as line coverage across the server and UI
  lcov files.

What the spike (`spike/coverage`, run 42474889512) established on Ubuntu:

| Measure | Per process, raw | After keeping `server/src` only |
| --- | --- | --- |
| Coverage file | ~20 MB | ~3 MB, of which ~2.9 MB are our own source maps |

Integration batches of 20 suites wrote 0.8–2.1 GB raw; filtered, 1.2 GB in all for 101
suites. c8 mapped the tsx output back to TypeScript through the source maps node stores in
each file, and merged unit and integration data: lines 94.91% (41,615/43,843), branches
86.48% (11,527/13,328), functions 97.18% (1,517/1,561).

## Goals / Non-Goals

**Goals:**

- One instrumented server run on Ubuntu that yields the full-inventory figure and fails below
  the thresholds.
- Bounded disk use and no step that parses an unfiltered child coverage file.
- Unchanged behaviour outside coverage mode, on every platform.

**Non-Goals:**

- Coverage on Windows or macOS. Those legs keep their uninstrumented runs.
- UI coverage, which Vitest already measures over its own sources.
- Coverage of processes other than the server under test (the pi agent, terminals,
  `npm` children).
- Raising coverage. This change measures; filling the gaps it reveals is separate work.

## Decisions

### Collect with `NODE_V8_COVERAGE`, report with c8

The server child gets `NODE_V8_COVERAGE` pointing at a per-run directory, and the test
processes keep the one node's runner sets. A final step merges everything with c8
(`c8 report --all --src server/src`), which applies the source maps node records in each
file.

Alternatives considered: node's `--experimental-test-coverage` alone cannot see child
processes, and its reporter is what truncated at 10 MB. Istanbul instrumentation through a
tsx hook would need a build-time transform and slows every run. `monocart-coverage-reports`
can do the same as c8 but is a larger dependency with no advantage here.

### Write once, at a clean exit

In coverage mode the harness waits up to 15 s after SIGTERM before SIGKILL, so the server
runs its shutdown and `process.exit(0)` writes the coverage once. Outside coverage mode the
300 ms grace is unchanged.

Alternative considered: periodic `v8.takeCoverage()` inside the server. The local Windows
spike used it, since `taskkill /F` gives no chance to write at exit; it writes 20 MB every
interval per process and cost about four minutes per batch of eight suites. It also needs
product code to know about tests. Coverage runs only on Linux, so it is not needed.

### Filter each child as soon as it stops

After a server in coverage mode exits, the harness rewrites the files it wrote: keep only
the `result` entries and source-map entries whose URL lies under `server/src`, and drop the
rest. A file that fails to parse (a child killed mid-write) is moved aside and counted, not
fed to the reporter. The filter lives in one module used by the harness and by the final
step, which re-checks anything the harness could not reach (a test that killed its server
itself).

Keeping only one copy of our source maps across processes would cut the remaining ~3 MB per
process to a fraction. It is an optimisation, adopted only if the per-run total measured in
CI makes it necessary: the spike's 1.2 GB fits the runner's disk.

### Coverage mode is one explicit switch

A single variable, set only by the coverage script, turns on the server child's coverage
directory and the longer grace. The harness computes the child's `NODE_V8_COVERAGE` through
one helper that returns `""` unless that switch is on. The server's own spawners are not
touched, so agent and terminal children never inherit coverage. The guard test learns this
helper as a recognised form; its other checks stay as they are.

### One Ubuntu step replaces two

`npm run test:coverage --workspace server` runs every server suite, unit and integration,
with the same batching and concurrency as `scripts/test.mjs`, then merges and checks the
thresholds. On Ubuntu it replaces `npm test --workspace server`; Windows keeps
`npm test --workspace server`. The summary and badge scripts read the merged lcov.

### Exclusions in one file, thresholds from the measurement

The exclusion list moves to one file with a reason per entry: generated code
(`src/generated/**`), the bundled reference validator, and type declarations (`*.d.ts`, so
`pdfjs-worker.d.ts`). Thresholds start just under the spike's values, leaving room for run
to run noise: lines and statements 93, branches 85, functions 95. The maintainer can tighten
them after a few runs on `main`.

### The badge keeps its formula

The badge stays "line coverage across the server and UI lcov files". Only the server input
changes, so the badge's meaning changes with it, which `docs/quality.md` states. The
`SUBPROCESS_ONLY` special case in the summary is removed.

## Risks / Trade-offs

- [The Ubuntu `check` job grows by about four minutes] → It replaced two steps in the spike
  and stays under the Windows job's 27 min; measure again in the PR and run the coverage
  step on `main` only if the wall time grows by more than a few minutes.
- [A server that hangs on shutdown now holds a test up to 15 s] → Only in coverage mode, and
  such a hang is itself a defect the log will show.
- [Disk use on the runner] → Per-child filtering bounds it to ~1.2 GB in the spike; the
  run fails clearly if the disk fills, and source-map deduplication is ready as a fallback.
- [Thresholds too tight for run-to-run variation] → Start below the measured values, then
  adjust once the variation across several runs is known.
- [c8 version drift changes the numbers] → Pin c8 in the lockfile like any dev dependency.

## Migration Plan

1. Land the harness switch, the filter and the guard-test update with the new
   `test:coverage` script, behind the switch.
2. Switch the Ubuntu CI step and the summary and badge scripts in the same PR, with the new
   thresholds, and record the measured CI time in the PR.
3. Update `docs/quality.md`, `docs/development.md` and `docs/openssf.md`.
4. Rollback: restore the two previous Ubuntu steps and the old `test:coverage` script; the
   harness switch is inert when unset.
5. Delete the `spike/coverage` branch and its temporary workflow.
