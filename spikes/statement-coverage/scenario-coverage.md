# Spike evidence against existing coverage scenarios

This is an experiment, not a replacement coverage implementation. No existing OpenSpec
task is marked complete by it. Intent: assess reliable statements and cost for an
independent daily run. Existing `measure-integration-coverage` artifacts require the
current three-scope merged inventory; the implementation currently publishes lines,
branches and functions only. This spike investigates an additional measurement and
does not silently redefine that contract. OpenLore orientation returned a stale keyword
index without the graph; targeted source/spec/test reads supplied the implementation
evidence. `rg '^#### Scenario:' openspec/` was used to verify the scenario inventory.

Status refers to evidence in this spike, not to whether the existing pipeline passes
its own tests. The relevant delta spec has 15 scenarios; all are enumerated below.

| Scenario | Status | Experimental assertion / remaining gap |
|---|---|---|
| CodeReachedOnlyThroughTheServerProcessIsCovered | covered | `benchmark.mjs`: the `real-server-child` Istanbul case requires actual `server/src/index.ts` in the map with executed statements after `integration-case.mjs` HTTP/WS assertions. |
| UnitAndIntegrationCountsAreMerged | covered | `summarize.mjs`: `unit and integration use the same source instruction inventory` and `unit/integration union …` check every instruction's hit union for real `config.ts`. |
| SharedCodeRunOnlyByUiTestsIsCovered | covered | `benchmark.mjs`: `UI must credit the shared production source`; `summarize.mjs` verifies the real shared math module is in both maps, with 0/65 server-only and 63/65 after UI. |
| SharedCountsAreTheUnionOfServerAndUiSuites | covered | `summarize.mjs`: identical statement/function/branch maps and `union for statement …` for every instruction of the actual shared module. `run-fixtures.mjs`: `union credits the child without double-counting`. |
| UnloadedFileCountsAsUncovered | partial | `run-fixtures.mjs`: unloaded fixture has exactly 0/2 instructions and raises merged denominator to 13. Full production inventory seeding is not implemented. |
| CentralEntryPointIsMeasured | covered | `benchmark.mjs`: `actual child index.ts must be measured`, plus nonzero covered statements. |
| CommentLinesAreNotCounted | covered | `run-fixtures.mjs`: exact 11-instruction count and `type-only declarations and comments excluded`; two instructions on one line are separately asserted. |
| ExcludedFileIsNamedInTheSummary | uncovered | Existing pipeline is unchanged. The experimental Node hook does not yet reuse every central exclusion; no replacement exclusion summary is claimed. |
| UnlistedFileCannotBeExcludedSilently | partial | Explicit fixture inventory checks an unloaded file. The spike does not instrument/seed the entire production inventory. |
| SummaryShowsNumeratorAndDenominator | partial | `findings.json` contains exact covered/total per experiment and shared module. No complete per-file product report is produced. |
| CoverageBelowThresholdFailsCi | uncovered | No workflow or threshold policy is introduced. Existing pipeline thresholds are unchanged; a full new statement measurement is needed first. |
| LargeDependencyDoesNotInflateCoverageData | partial | Istanbul selects owned server/shared code; third-party code is not instrumented. The V8 comparison is raw and the production pipeline's complete reduction is not benchmarked. |
| UnreadableChildCoverageIsReported | uncovered | The experiment verifies graceful exits and valid dumps. Killed/incomplete child collection still needs negative testing before integration. |
| AgentChildReceivesNoCoverageSink | uncovered | The spike does not launch model/terminal children or prove every fork's environment/execArgv isolation. Explicit loader invocation is not sufficient proof of that contract. |
| ServerChildWritesNoCoverageOutsideCoverageMode | partial | Baseline benchmark explicitly passes no spike loader and disables native V8. Existing harness outside-coverage behavior is unchanged; no complete child inventory test is added. |

The fixture and selected real tests pass, so feasibility is established. The uncovered
and partial rows are integration work required before calling a nightly feature complete
or using a new full-product percentage in OpenSSF.


The shutdown follow-up adds `trial-lifecycle-selftest.mjs` controls for normal exit,
failed startup, owner identification, slow SIGTERM flush and SIGKILL loss. These
support `UnreadableChildCoverageIsReported` with actual subprocess outcomes; they
do not turn the exploratory workflow into the specified production CI policy.
The first complete-suite run still failed collection integrity (two absent dumps).
All partial/uncovered integration classifications above remain open.
