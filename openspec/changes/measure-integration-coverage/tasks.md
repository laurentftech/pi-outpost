# Tasks

Work on the branch `openspec/measure-integration-coverage`. The figures to compare against are the spike's
(design.md, Context). Everything lands in one pull request: the CI switch only makes sense
with the harness and filter behind it.

## 1. Coverage mode in the harness

- [x] 1.1 Add one helper that returns the server child's `NODE_V8_COVERAGE` (the run's coverage directory when the coverage switch is set, `""` otherwise) and use it in `server/test/harness.mjs`; teach `server/test/testChildEnvironment.test.ts` to accept that helper and nothing looser; verify the guard test passes, still refuses its existing unsafe forms, and a test shows the helper returns `""` without the switch (scenario ServerChildWritesNoCoverageOutsideCoverageMode)
- [x] 1.2 In coverage mode only, wait up to 15 s after SIGTERM before SIGKILL in the harness's `stop()`; verify by a harness test that a coverage-mode server leaves a coverage file after `stop()` and that the grace is unchanged without the switch
- [x] 1.3 Verify the server's own spawners still blank the sink in coverage mode: an integration test in coverage mode checks the fake agent child reports no coverage directory (scenario AgentChildReceivesNoCoverageSink)

## 2. Filter and merge

- [x] 2.1 Add a coverage filter module that keeps only `result` and source-map entries under `server/src` and `shared/src`, moves an unparseable file aside and reports it; unit-test it on fixture files: a pdf.js entry is dropped, a `server/src` entry kept, a truncated file reported without throwing (scenarios LargeDependencyDoesNotInflateCoverageData, UnreadableChildCoverageIsReported)
- [x] 2.2 Call the filter from the harness right after a coverage-mode server exits, and again over the whole directory before the report; verify after a local coverage run that no file in the directory exceeds a few MB
- [x] 2.3 Add `c8` as a pinned dev dependency of the server workspace (lockfile regenerated with npm 12.2.2, no install scripts) and record the decision with `record_decision`; verify `npm ci` passes with the root `.npmrc` policy
- [x] 2.4 Move the exclusions to one file with a reason per entry (`shared/src/generated/**`, `**/*.d.ts`); verify a test fails if a `server/src` or `shared/src` file is excluded without being listed (scenarios ExclusionsArePublishedWithTheirReason, UnlistedFileCannotBeExcludedSilently)

## 3. The coverage run

- [x] 3.1 Rewrite `npm run test:coverage --workspace server` to run every server suite, unit and integration, with `scripts/test.mjs`'s batching, in coverage mode, then merge with c8 `--all` over `server/src` and `shared/src`, measure the full figure, set the thresholds just under it and fail below them; verify locally under Linux (CI or WSL) that it passes on `main`'s code and fails when a threshold is raised above the measured value (scenarios ServerCoverageIncludesIntegrationSuites, UnitAndIntegrationCountsAreMerged, ThresholdsFailTheRun)
- [x] 3.2 Verify on a fixture file under `server/src` that no test imports that the report lists it at 0% and counts it, and that `src/index.ts` is in the total (scenarios UnloadedFileCountsAsUncovered, CentralEntryPointIsMeasured)

## 4. CI, summary and badge

- [x] 4.1 In `.github/workflows/ci.yml`, replace the Ubuntu `npm test --workspace server` and `test:coverage` steps with the single coverage step; Windows keeps `npm test --workspace server`; update the comments that explain the exclusions; verify in the PR's CI that the Ubuntu job passes and record its duration against the last `main` run (24 min Ubuntu, 27 min Windows)
- [x] 4.2 Update `scripts/coverage-summary.mjs`: drop `SUBPROCESS_ONLY`, report covered/total for lines, statements, branches and functions, and print the exclusion list; extend its script test (scenarios SummaryShowsNumeratorAndDenominator, ExcludedFileIsNamedInTheSummary)
- [x] 4.3 Point `scripts/coverage-badge.mjs` at the merged server lcov (formula unchanged); verify its script test and the badge job's inputs in `ci.yml`
- [x] 4.4 Update `docs/quality.md` (checks table, "What the coverage badge means", thresholds), `docs/development.md` (tests and coverage, how to run it locally under Linux) and `docs/openssf.md` (coverage action and change log); verify the documented commands run as written and local links resolve

## 5. Proof

- [x] 5.1 Write `openspec/changes/measure-integration-coverage/scenario-coverage.md` mapping every scenario to its test, reading the assertions; run `npm run check:scenarios` and `openspec validate measure-integration-coverage --strict`
- [x] 5.2 Run the full suites, typecheck and lint; verify the PR's CI is green on Ubuntu and Windows, and the summary shows the new figures

## Workflow follow-up

- Delete the `spike/coverage` branch (its temporary workflow goes with it) once the PR is merged.
- Archive the change after merge.
