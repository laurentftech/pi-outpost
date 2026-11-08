# Statement coverage spike

Isolated experiment against main `aaa029434f42fc31b6818c2c51498171f2c27b41`
(2026-11-08). It changes no production source, existing coverage pipeline, thresholds,
root dependency/lockfile, or GitHub workflow. No schedule is enabled.

## Findings

**Use Istanbul source instrumentation for an independent statement measurement.** The
prototype instruments original TypeScript with `istanbul-lib-instrument`, then compiles
the instrumented code with esbuild. A Node loader handles the server and a Vite pre-plugin
handles the UI. Both use the same canonical source paths and statement inventory.

The [official TypeScript recipe](https://istanbul.js.org/docs/tutorials/typescript/)
works in its `require` / ts-node setting. It is not a drop-in wrapper for this repository:

| Experiment | Observed outcome |
|---|---|
| Tutorial shape: nyc + ts-node + source maps + `all: true` | Runs successfully. On this fixture it reports 15 statements, including transpilation/export scaffolding, rather than the 11 original-source instructions. |
| Same nyc recipe around ESM/tsx | Refuses the ESM `.ts` with `Must use import to load ES Module`. |
| ESM/tsx with nyc `all` disabled | Exits successfully but reports **zero files**. This is not valid coverage evidence. |
| Raw V8 + `ast-v8-to-istanbul` | Converts tsx output, but on this fixture counts 17 statements and marks the return after a throwing call as executed. |
| Istanbul applied to original TypeScript | Counts the expected 11 instructions; six executed by the first process, nine by the union of both processes. The return after the throw remains unexecuted. |

The V8 after-throw limitation is also documented by
[ast-v8-to-istanbul](https://github.com/AriPerkkio/ast-v8-to-istanbul#limitations).
This spike does not establish that a carefully configured AST converter could never
remove the generated scaffolding. It does demonstrate that the direct conversion is
insufficient on a case important to error-path testing.

Other checks:

- Two instructions on one line are counted separately.
- Comments, interfaces, type aliases and type-only imports add no instructions.
- An uncalled function remains uncovered; an entirely unloaded file is added at zero
  (two additional instructions). The fixture inventory is then 9/13 statements covered.
- A real child server passes HTTP health/bearer checks, valid WS hello and bad-token
  close 4401 with no data. Its `server/src/index.ts` is present with executed statements.
- The existing configuration/transport unit tests pass under instrumentation.
- The existing UI math tests credit `shared/src/markdownMath.ts`; eight real React TSX
  TokenGate tests also pass with instrumentation.
- The Node and Vite reports have identical statement/function/branch maps for shared
  math. Its merged statements are 63/65, with one denominator. The configuration file's
  unit/integration reports are also checked instruction-by-instruction for the union.
- Windows paths are canonicalized before instrumentation to prevent double-counting
  the same shared file under slash and backslash spellings.

## Cost measured locally

Three sequential samples per mode and workload, rotating the mode order. Node 26.4.0,
Windows, Intel i5-7500. Dependencies were already installed. Values are medians:

| Selected workload | No coverage | Native V8 | Original-source Istanbul |
|---|---:|---:|---:|
| Server config + transport unit tests | 1.62 s | 2.77 s | 4.02 s |
| Real child startup + HTTP/WS assertions + shutdown | 6.46 s | 9.39 s | 17.29 s |
| UI math suite | 3.66 s | 4.26 s | 4.22 s |

These are **not whole-suite timings or a forecast of CI duration**. The V8 server
column collects native V8 and executed-source data, without the current pipeline's
complete filtering/conversion/report steps. UI V8 uses Vitest's built-in provider,
not the current MCR custom provider. Istanbul is an uncached prototype; its Node
hook lets tsx load the module before replacing it, so compilation work is duplicated.
There is no full nightly percentage here, and no comparison of these partial tests'
percentages with the official whole-suite figures. An unrelated agent was active on
the machine; the rotating order reduces but cannot remove timing noise.

Raw maps, logs and individual samples remain under ignored `results/`.
[`findings.json`](findings.json) records the compact results and fixture assertions.

## Reproduce

Install the repository's locked dependencies with its pinned npm 12.2.2. In addition,
install the isolated experiment's locked tools; its `package-lock.json` is separate:

```sh
npm ci --prefix spikes/statement-coverage
node spikes/statement-coverage/run-fixtures.mjs
node spikes/statement-coverage/benchmark.mjs
node spikes/statement-coverage/summarize.mjs
```

The benchmark defaults to three samples and runs processes sequentially. It never
launches a browser or sends a model request. The real-server case uses a disposable
workspace and a fake test token. On Windows its owned stdin allows an exit-time dump
before the child exits; this deliberately avoids the real harness's `taskkill /F`.
That exit path is a test driver, not a proposed app control or production change.

The loader only activates when explicitly imported with a spike mode/output directory;
it does not use `NODE_OPTIONS`. Neither the benchmark nor the fixtures edit tracked
application files. All modules are measured by standard Istanbul counters; the adapter
only selects sources, transpiles and writes the counters at exit.

## Recommendation and remaining work

Proceed with a **manual Linux workflow first**, then schedule it daily on `main` if the
full-suite result is reliable and its cost acceptable. Keep it independent of the PR
critical path. Publish a report tied to an exact commit, numerator/denominator,
exclusions, tool versions and threshold outcome. A daily result establishes the
measured commit's coverage; it does not guarantee every intervening PR met a statement
threshold. Keep the existing PR line/branch/function thresholds in place.

Before enabling that workflow:

1. Run the complete suites under the candidate instrumentation on supported Node 24
   and Linux, including the real harness's graceful shutdown and all subprocess paths.
2. Reuse the central inventory/exclusions. The spike's Node hook selects server/shared
   directories and does not yet apply every production exclusion. Add all unloaded
   production files at zero, not just the fixture, and reconcile other workspaces.
3. Verify normal, signalled and failed exits. Fail/report missing or incomplete dumps
   explicitly; a green test result with absent coverage is not a valid measurement.
4. Enforce collection boundaries for agent, terminal and other forked children. The
   experiment explicitly loads only owned processes but does not prove every real
   child's environment/execArgv isolation.
5. Benchmark complete collection, conversion and report time. Consider a content-keyed
   instrumentation cache; no cache benefit was measured here.
6. Set statement thresholds from the new full report. Do not copy a line percentage
   into the statement field, and do not infer 80/90% from this partial exercise.

This is a completed feasibility experiment, **not an implemented nightly feature**.
Existing OpenSpec coverage requirements remain unchanged; the companion scenario
matrix records what this spike proves and what it leaves open. No new OpenSSF claim
is justified by these partial benchmark percentages.

## Branch-only full-suite Linux trial

The `Statement coverage experiment` workflow runs only on pushes to the isolated
`codex/statement-coverage-spike` branch (or manual dispatch once registered). It has
no daily schedule, is not a required PR check and does not alter normal CI. Its first
run is an experiment, not adoption of a new coverage policy.

It runs the fixture controls, collector self-tests, then the complete server and UI
suites on Node 24/Linux. The Node loader admits only test files and the actual server
entry point; unrelated eval, agent-fixture and external child entries install no hook
or collector. Original source maps are stored once and processes write compact hit
counts. SIGTERM takes a synchronous snapshot before the harness's force-kill fallback;
an exit dump supersedes that snapshot. Missing, empty or truncated data invalidates
the report. Completed suite status records are also required.

The report seeds every source file in the three measured scopes at zero and checks
the observed statement/function/branch inventory against the original source. It
reuses central exclusions and additionally names the generated `embedded-web.ts`
bundle as excluded, because handwritten UI sources are already measured separately.
Other production workspaces remain outside these scopes and are named as such.

The workflow publishes a dated/commit-specific summary, numerator/denominator for
statements, branches and functions, per-file data, collection-integrity status and
suite durations as an artifact. Statement percentages are observations; 80/90% are
not blocking adoption thresholds for this exploratory run. Test failures or invalid
collection fail the workflow and prevent treating its report as a passing result.

Local collector validation:

```sh
node spikes/statement-coverage/trial-selftest.mjs
```

To reproduce the full trial on Linux after installing the same prerequisites as CI:

```sh
node spikes/statement-coverage/trial-run.mjs
```


### Follow-up: shutdown diagnostics

The first full Linux run is recorded in [linux-trial-results.md](linux-trial-results.md).
Both suites passed, but two absent dumps invalidated the measurement. The next
trial records each measured process's owning test, PID/parent PID, spawn/close
status, and flush start/completion. Lifecycle records and expected-process markers
are uploaded with the report; command arguments and environment values are not.

Only inside the experimental Node loader, the harness's shutdown allowance is
adapted to its existing 15-second coverage grace period. Production harness files,
normal CI and runtime sources are unchanged. The adapter fails on source drift.
This is a test-environment adaptation, not proof that timeout caused the first loss.

Collector controls now cover a normal exit, a failed startup, a deliberately slow
SIGTERM flush (one second, beyond the old 300ms budget), and an unrecoverable
SIGKILL which must remain a missing-dump failure. POSIX signal controls run on
Linux; Windows runs the normal/failed-start and ownership controls. A test-only
fixture entry is admitted solely when SPIKE_TRIAL_SELFTEST=1.


The first shutdown follow-up collected all 728 expected dumps, but correctly
failed because the adapter also changed the pure `stopGraceMs()` policy function
under test. The corrected adapter changes only `stop()`'s wait call in the trial;
the original policy function and its regression assertions remain intact. That
exact regression now runs in the collector preflight before a full-suite trial.
