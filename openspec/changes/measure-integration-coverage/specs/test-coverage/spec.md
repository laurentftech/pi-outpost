# Spec Delta

## Purpose

Defines what the project's test coverage figures measure — which suites and processes
contribute, over which inventory of source files, and what counts as a line — so a reported
percentage is a claim about the shipped code that anyone can check.

## ADDED Requirements

### Requirement: ServerCoverageIncludesIntegrationSuites
The server's coverage SHALL count the code run by the integration suites inside the server
processes they start, together with the code run by the unit suites, in one figure.

#### Scenario: CodeReachedOnlyThroughTheServerProcessIsCovered
- **GIVEN** a server function that only an integration suite reaches, through the server it starts
- **WHEN** the coverage run completes
- **THEN** that function's lines are reported as covered

#### Scenario: UnitAndIntegrationCountsAreMerged
- **GIVEN** a source file whose lines are run partly by a unit suite and partly by an integration suite
- **WHEN** the coverage run completes
- **THEN** the file's covered lines are the union of both

### Requirement: SharedCodeIsCreditedByEverySuite
The coverage of `shared/src` SHALL count the code run by the server suites and by the UI
suites together: a line, branch or function is covered when any suite runs it.

#### Scenario: SharedCodeRunOnlyByUiTestsIsCovered
- **GIVEN** a function in `shared/src` that only a UI test runs
- **WHEN** the coverage run completes
- **THEN** that function and its lines are reported as covered

#### Scenario: SharedCountsAreTheUnionOfServerAndUiSuites
- **GIVEN** a file in `shared/src` run partly by a server suite and partly by a UI suite
- **WHEN** the coverage run completes
- **THEN** its covered lines, branches and functions are the union of both, over one total

### Requirement: CoverageIsComputedOverTheFullInventory
Coverage SHALL be computed over every source file under `server/src`, `shared/src` and
`ui/src`, except the files on a published exclusion list, with a figure for each of the three.
A file that no test loads SHALL count with all its lines uncovered.

#### Scenario: UnloadedFileCountsAsUncovered
- **GIVEN** a new file under `server/src` that no test imports
- **WHEN** the coverage run completes
- **THEN** the report lists that file at 0% and its lines are in the total

#### Scenario: CentralEntryPointIsMeasured
- **WHEN** the coverage run completes
- **THEN** `server/src/index.ts` is in the report and counted in the total, not set aside

### Requirement: OnlyExecutableCodeIsCounted
A line SHALL count toward coverage only when it produces code: comments, blank lines and
what TypeScript erases (interfaces, type aliases, type-only imports) SHALL be neither covered
nor uncovered lines. A file that produces no code SHALL NOT be owed in the report.

#### Scenario: CommentLinesAreNotCounted
- **GIVEN** a source file with comment and blank lines inside a function the tests run
- **WHEN** the coverage run completes
- **THEN** those lines are absent from the file's line total, and its covered lines are lines of code

### Requirement: ExclusionsArePublishedWithTheirReason
Every file left out of the inventory SHALL be listed, with the reason, in one place that the
coverage run reads, and the run summary SHALL show that list.

#### Scenario: ExcludedFileIsNamedInTheSummary
- **GIVEN** a file on the exclusion list
- **WHEN** the coverage summary is written
- **THEN** it names that file and the reason it is excluded

#### Scenario: UnlistedFileCannotBeExcludedSilently
- **GIVEN** a file under `server/src`, `shared/src` or `ui/src` that is not on the exclusion list
- **WHEN** the coverage run completes
- **THEN** that file is part of its scope's total

### Requirement: SummaryPublishesCountsNotOnlyPercentages
The coverage summary SHALL report, for each scope and each file, and for lines, branches and
functions, the covered count and the total count behind each percentage.

#### Scenario: SummaryShowsNumeratorAndDenominator
- **WHEN** the coverage summary is written
- **THEN** each of lines, branches and functions shows covered/total and the percentage, per scope and per file

### Requirement: ThresholdsFailTheRun
The coverage run SHALL fail when a scope's line, branch or function coverage falls below the
threshold configured for that scope.

#### Scenario: CoverageBelowThresholdFailsCi
- **GIVEN** a change that leaves a scope's branch coverage below its threshold
- **WHEN** the coverage run completes
- **THEN** the run exits non-zero and names the scope and the measure that fell short

### Requirement: ChildCoverageCannotBreakTheRun
A server process's coverage data SHALL be reduced to the measured sources (`server/src` and
`shared/src`) before the run reads it, so its size stays bounded whatever the dependencies the process loaded.

#### Scenario: LargeDependencyDoesNotInflateCoverageData
- **GIVEN** an integration suite whose server loads pdf.js
- **WHEN** that server stops in a coverage run
- **THEN** the coverage kept for it contains only entries for files under `server/src` or `shared/src`

#### Scenario: UnreadableChildCoverageIsReported
- **GIVEN** a server killed before it finished writing its coverage
- **WHEN** the coverage run reads that server's data
- **THEN** the run reports the unreadable file and continues, rather than failing on a JSON parse error

### Requirement: CoverageStaysOutOfOtherChildren
Coverage collection SHALL reach only the server processes the test harness starts in
coverage mode. Agent, terminal and other processes the server starts SHALL NOT write
coverage, and outside coverage mode no child SHALL write coverage.

#### Scenario: AgentChildReceivesNoCoverageSink
- **GIVEN** a coverage run
- **WHEN** the server under test starts an agent child process
- **THEN** that child has no coverage directory set

#### Scenario: ServerChildWritesNoCoverageOutsideCoverageMode
- **GIVEN** a test run that is not a coverage run
- **WHEN** the harness starts a server
- **THEN** that server has no coverage directory set
