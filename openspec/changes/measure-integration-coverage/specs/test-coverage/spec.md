# Spec Delta

## Purpose

Defines what the project's test coverage figures measure — which suites and processes
contribute, over which inventory of source files — so a reported percentage is a claim about
the shipped server code that anyone can check.

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

### Requirement: CoverageIsComputedOverTheFullInventory
The server percentages SHALL be computed over every source file under `server/src`, except
the files on a published exclusion list. A file that no test loads SHALL count with all its
lines uncovered.

#### Scenario: UnloadedFileCountsAsUncovered
- **GIVEN** a new file under `server/src` that no test imports
- **WHEN** the coverage run completes
- **THEN** the report lists that file at 0% and its lines are in the total

#### Scenario: CentralEntryPointIsMeasured
- **WHEN** the coverage run completes
- **THEN** `server/src/index.ts` is in the report and counted in the total, not set aside

### Requirement: ExclusionsArePublishedWithTheirReason
Every file left out of the server inventory SHALL be listed, with the reason, in one place
that the coverage run reads, and the run summary SHALL show that list.

#### Scenario: ExcludedFileIsNamedInTheSummary
- **GIVEN** a file on the exclusion list
- **WHEN** the coverage summary is written
- **THEN** it names that file and the reason it is excluded

#### Scenario: UnlistedFileCannotBeExcludedSilently
- **GIVEN** a file under `server/src` that is not on the exclusion list
- **WHEN** the coverage run completes
- **THEN** that file is part of the total

### Requirement: SummaryPublishesCountsNotOnlyPercentages
The coverage summary SHALL report, for lines, statements, branches and functions, the
covered count and the total count behind each percentage.

#### Scenario: SummaryShowsNumeratorAndDenominator
- **WHEN** the coverage summary is written
- **THEN** each of lines, statements, branches and functions shows covered/total and the percentage

### Requirement: ThresholdsFailTheRun
The coverage run SHALL fail when the server's line, branch or function coverage over the
inventory falls below its configured threshold.

#### Scenario: CoverageBelowThresholdFailsCi
- **GIVEN** a change that leaves server branch coverage below its threshold
- **WHEN** the coverage run completes
- **THEN** the run exits non-zero and names the measure that fell short

### Requirement: ChildCoverageCannotBreakTheRun
A server process's coverage data SHALL be reduced to the server's own sources before the run
reads it, so its size stays bounded whatever the dependencies the process loaded.

#### Scenario: LargeDependencyDoesNotInflateCoverageData
- **GIVEN** an integration suite whose server loads pdf.js
- **WHEN** that server stops in a coverage run
- **THEN** the coverage kept for it contains only entries for files under `server/src`

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
