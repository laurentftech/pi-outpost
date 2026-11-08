# Scenario coverage

Scenario inventory: `rg '^#### Scenario:' openspec/`. The `test-coverage` capability has no
main spec yet; all twelve scenarios are in this change's delta.

One test skips on Windows, where the harness ends a server with `taskkill /F` and the coverage
run refuses to start: the server half of `server/test/coverageRun.test.mjs` runs on the Ubuntu
leg, inside the coverage run itself.

| Scenario | Status | Evidence |
| --- | --- | --- |
| CodeReachedOnlyThroughTheServerProcessIsCovered | covered | `server/test/coverageRun.test.mjs`, "AgentChildReceivesNoCoverageSink: a coverage-run server writes its coverage on stop, its agent child none": the test process never imports `server/src/index.ts`; c8, run with the coverage run's arguments over the server's own file only, must report more than 1,000 of its lines as run. |
| UnitAndIntegrationCountsAreMerged | covered | `server/test/coverageReport.test.mjs`, "UnitAndIntegrationCountsAreMerged: a file run partly by each process is covered by both": two processes each run one of a module's two functions; the report counts 2/2 functions and 100% of lines. |
| UnloadedFileCountsAsUncovered | covered | `server/test/coverageReport.test.mjs`, "a module nothing loads is reported at 0% and counted in the total": on real V8 data, the unloaded module is in the report at 0 covered lines and in the total. `server/test/coverageConfig.test.ts`, "UnloadedFileCountsAsUncovered: a run whose report omits an inventory file is caught": `missingFromReport` names an unloaded inventory file and not excluded or out-of-root ones; `server/scripts/test-coverage.mjs` fails the run on any such file. |
| CentralEntryPointIsMeasured | covered | `server/test/coverageConfig.test.ts`, "CentralEntryPointIsMeasured: index.ts is in the inventory the report must account for" and "UnlistedFileCannotBeExcludedSilently…": `server/src/index.ts` and `embeddedRuntime.ts` are tracked, match no exclusion, and a report without `index.ts` is caught. `coverageRun.test.mjs` (above) reads `index.ts` in a real report. |
| ExcludedFileIsNamedInTheSummary | covered | `scripts/coverage-summary.test.mjs`, "ExcludedFileIsNamedInTheSummary: the summary names every exclusion and its reason": every `COVERAGE_EXCLUSIONS` entry appears with its reason, and the old "measured apart" note is gone. `server/scripts/test-coverage.mjs` prints the same list in the run log. |
| UnlistedFileCannotBeExcludedSilently | covered | `server/test/coverageConfig.test.ts`, "UnlistedFileCannotBeExcludedSilently: the report excludes exactly the listed patterns, over both roots": the `--exclude` arguments are exactly the list, `--src`/`--include` are exactly the roots, `--all` is set, and the tracked files the list leaves out are only declarations and generated validators. "ExclusionsArePublishedWithTheirReason…" fails on a pattern that matches nothing. |
| SummaryShowsNumeratorAndDenominator | covered | `scripts/coverage-summary.test.mjs`, "SummaryShowsNumeratorAndDenominator: every measure shows covered/total and the percentage": the workspace row shows `94.9% (41615/43843)` for lines and statements, then branches and functions, and per-file rows carry counts. |
| CoverageBelowThresholdFailsCi | covered | `server/test/coverageReport.test.mjs`, "CoverageBelowThresholdFailsCi: a measure below its threshold fails the report and is named": c8 with the run's arguments exits non-zero and names `functions` when the fixture falls below its threshold. `server/test/coverageConfig.test.ts`, "the thresholds reach c8 as given", checks the real thresholds are passed. |
| LargeDependencyDoesNotInflateCoverageData | covered | `server/test/coverageFilter.test.ts`, "LargeDependencyDoesNotInflateCoverageData: only server/src and shared/src entries and source maps survive": a file with a pdf.js entry and a large map keeps only the `server/src` and `shared/src` entries, under a tenth of its size. `coverageRun.test.mjs` checks a real server's file holds nothing outside the roots once `stop()` returns. |
| UnreadableChildCoverageIsReported | covered | `server/test/coverageFilter.test.ts`, "UnreadableChildCoverageIsReported: a truncated file is set aside and named, not thrown on": a truncated file is renamed `.unreadable`, listed, and the readable file is still kept. |
| AgentChildReceivesNoCoverageSink | covered | `server/test/coverageRun.test.mjs`, "AgentChildReceivesNoCoverageSink…": a server started in a coverage run launches the fake agent (`server/test/fixtures/fake-pi-rpc.mjs`), which records `NODE_V8_COVERAGE`; it must be empty while the server's own coverage file exists. |
| ServerChildWritesNoCoverageOutsideCoverageMode | covered | `server/test/testChildEnvironment.test.ts`, "ServerChildWritesNoCoverageOutsideCoverageMode: the server's sink is blank unless a coverage run names one", with "the guard refuses the forms that look safe and are not": only `serverCoverageSink()` may give the harness's server a sink, and an arbitrary `process.env` value is refused. `coverageRun.test.mjs`, "stop() keeps its short grace outside a coverage run…". |

CI evidence: the Ubuntu leg of [PR #461](https://github.com/laurentftech/pi-outpost/pull/461)
runs `npm run test:coverage --workspace server`, which runs every one of these tests and then
the real report: lines and statements 95.0% (59,634/62,756), branches 87.3%, functions 96.3%
over `server/src` and `shared/src`, on two runs.
