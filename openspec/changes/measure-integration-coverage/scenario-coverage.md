# Scenario coverage

Scenario inventory: `rg '^#### Scenario:' openspec/`. The `test-coverage` capability has no
main spec yet; all fifteen scenarios are in this change's delta.

One test skips on Windows, where the harness ends a server with `taskkill /F` and the server's
coverage run refuses to start: the server half of `server/test/coverageRun.test.mjs` runs on
the Ubuntu leg, inside the coverage run itself. The report tests in
`scripts/coverage-report.test.mjs` run real V8 data from two node processes through the same
converter and merge as the coverage run, on every platform.

| Scenario | Status | Evidence |
| --- | --- | --- |
| CodeReachedOnlyThroughTheServerProcessIsCovered | covered | `server/test/coverageRun.test.mjs`, "AgentChildReceivesNoCoverageSink: a coverage-run server writes its coverage on stop, its agent child none": the test process never imports `server/src/index.ts`; the server's own file, converted (`server/test/coverageConvert.mjs`) and reported (`scripts/coverage-report.mjs`) as the run does, must show more than 500 of its lines of code run (about 900 on CI). |
| UnitAndIntegrationCountsAreMerged | covered | `scripts/coverage-report.test.mjs`, "SharedCountsAreTheUnionOfServerAndUiSuites: one total, and the union of both sides' hits": two processes each run part of one file; the merged report has one total and every function covered. The merge does not depend on which suites the processes belong to. |
| SharedCodeRunOnlyByUiTestsIsCovered | covered | `scripts/coverage-report.test.mjs`, "SharedCodeRunOnlyByUiTestsIsCovered: a function only the UI-side process runs counts as covered": `onlyTheUi` is run by the UI-side input alone; the merged lcov has a non-zero `FNDA` for it, and fewer functions are covered without that input. |
| SharedCountsAreTheUnionOfServerAndUiSuites | covered | `scripts/coverage-report.test.mjs`, same name: the server-only, UI-only and merged reports share one line and function total for the file, and the merge covers 3/3 functions and every line. |
| UnloadedFileCountsAsUncovered | covered | `scripts/coverage-report.test.mjs`, "a file no suite loads is in the report at 0%, and a report without it is caught": the unloaded module is reported with 0 covered lines and counted in the total, and `missingFromReport` names an unreported inventory file but not an excluded one. `scripts/coverage-report.mjs` fails the run on any such file. |
| CentralEntryPointIsMeasured | covered | `scripts/coverage-report.test.mjs` (above) checks `inInventory("server/src/index.ts")` and that a report without it is caught; `server/test/coverageRun.test.mjs` reads `server/src/index.ts` in a real report. |
| CommentLinesAreNotCounted | covered | `scripts/coverage-report.test.mjs`, "CommentLinesAreNotCounted: comment and blank lines are neither covered nor uncovered": in the merged lcov, lines 2, 4 and 7 of the fixture (a comment, a blank line, a comment) have no `DA` record while code lines do, and the line total is at most the file's lines minus those three. |
| ExcludedFileIsNamedInTheSummary | covered | `scripts/coverage-summary.test.mjs`, "ExcludedFileIsNamedInTheSummary: the summary names every exclusion and its reason": every `COVERAGE_EXCLUSIONS` entry appears with its reason. `scripts/coverage-report.mjs` prints the same list in the run log. |
| UnlistedFileCannotBeExcludedSilently | covered | `scripts/coverage-config.mjs` is the only exclusion list: `scopeOf` excludes exactly its patterns, and the report keeps a file exactly when `scopeOf` places it in a scope. `scripts/coverage-report.test.mjs` checks `missingFromReport` keeps `server/src/newFile.ts` (unlisted) owed and `server/src/pdfjs-worker.d.ts` (listed) not. |
| SummaryShowsNumeratorAndDenominator | covered | `scripts/coverage-summary.test.mjs`, "SummaryShowsNumeratorAndDenominator: lines, branches and functions show covered/total, per scope and per file": the scope rows show `94.9% (41615/43843)`, branches and functions, per-file rows carry counts, an empty scope shows `— (0/0)`. |
| CoverageBelowThresholdFailsCi | covered | `scripts/coverage-report.test.mjs`, "CoverageBelowThresholdFailsCi: a scope below a threshold fails, naming the scope and the measure": a fixture below its functions threshold yields exactly one failure, `shared functions … is below 99%`; the CLI exits non-zero on any failure. |
| LargeDependencyDoesNotInflateCoverageData | covered | `server/test/coverageFilter.test.ts`, "LargeDependencyDoesNotInflateCoverageData: only server/src and shared/src entries and source maps survive": a file with a pdf.js entry and a large map keeps only the `server/src` and `shared/src` entries, under a tenth of its size. `coverageRun.test.mjs` checks a real server's file once `stop()` returns. |
| UnreadableChildCoverageIsReported | covered | `server/test/coverageFilter.test.ts`, "UnreadableChildCoverageIsReported: a truncated file is set aside and named, not thrown on". |
| AgentChildReceivesNoCoverageSink | covered | `server/test/coverageRun.test.mjs`, "AgentChildReceivesNoCoverageSink…": a server started in a coverage run launches the fake agent (`server/test/fixtures/fake-pi-rpc.mjs`), which records `NODE_V8_COVERAGE`; it must be empty while the server's own coverage file exists. |
| ServerChildWritesNoCoverageOutsideCoverageMode | covered | `server/test/testChildEnvironment.test.ts`, "ServerChildWritesNoCoverageOutsideCoverageMode: the server's sink is blank unless a coverage run names one", with "the guard refuses the forms that look safe and are not". `coverageRun.test.mjs`, "stop() keeps its short grace outside a coverage run…". |

The converter is handed the code V8 ran: `server/test/stripDependencySourceMaps.test.ts`, "stores
no pdf.js source map in a process that loads pdf.js", also checks that a coverage-mode child
keeps tsx's output for `server/src/pdf.ts` (JavaScript with its source map) and nothing from
`node_modules`.
