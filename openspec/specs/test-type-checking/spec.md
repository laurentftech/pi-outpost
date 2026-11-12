# Test Type Checking Specification

## Purpose

Makes the repository's TypeScript tests subject to the same strict type checking as the code
they test, so a test that reads something which no longer exists fails CI instead of running.

## Requirements

### Requirement: TestSourcesAreTypeChecked
`npm run typecheck` SHALL type-check, with the strict settings of the code under test, every
TypeScript test source that a CI suite runs: UI unit tests, server tests and their TypeScript
fixtures, and end-to-end specs with their support files.

#### Scenario: IllTypedUiTestFailsTypecheck
- **GIVEN** a UI test that reads a property its value's type does not declare
- **WHEN** `npm run typecheck` runs
- **THEN** it exits non-zero and reports that test file

#### Scenario: IllTypedServerTestFailsTypecheck
- **GIVEN** a server test that passes an argument of the wrong type to the code it tests
- **WHEN** `npm run typecheck` runs
- **THEN** it exits non-zero and reports that test file

#### Scenario: IllTypedEndToEndSpecFailsTypecheck
- **GIVEN** an end-to-end spec that calls a helper with an argument of the wrong type
- **WHEN** `npm run typecheck` runs
- **THEN** it exits non-zero and reports that spec file
### Requirement: NoTestSourceEscapesTheCheck
The set of type-checked files SHALL include every TypeScript test file the CI suites run. A
test file added under a covered suite SHALL be checked without editing a list by hand.

#### Scenario: EveryRunTestFileIsChecked
- **GIVEN** the TypeScript test files tracked under `ui/src`, `server/test` and `e2e`
- **WHEN** they are compared with the files the type-check configurations include
- **THEN** none is missing

#### Scenario: NewTestFileIsCheckedWithoutConfiguration
- **GIVEN** a new ill-typed `*.test.ts` file added under `server/test`
- **WHEN** `npm run typecheck` runs, with no configuration file edited
- **THEN** it exits non-zero and reports the new file
### Requirement: TypeErrorsBlockMerging
A type error in a test SHALL fail the CI run of any pull request that is not
documentation-only, and so prevent merging.

#### Scenario: PullRequestWithIllTypedTestIsRed
- **GIVEN** a pull request whose only change introduces a type error in a test
- **WHEN** CI runs
- **THEN** the `check` job fails and `CI ok` fails
### Requirement: TypeErrorsAreNotSilenced
A test SHALL NOT silence a type error with `@ts-ignore` or `@ts-nocheck`. A
`@ts-expect-error` in a test SHALL state why the error is expected.

#### Scenario: IgnoreCommentInTestIsRefused
- **GIVEN** a test that adds `// @ts-ignore` above a line
- **WHEN** `npm run lint` runs
- **THEN** it exits non-zero and reports the comment

#### Scenario: UnexplainedExpectErrorIsRefused
- **GIVEN** a test that adds `// @ts-expect-error` with no description
- **WHEN** `npm run lint` runs
- **THEN** it exits non-zero and reports the comment
### Requirement: TransitionCeilingOnlyDecreases
While a suite still has type errors, its check MAY tolerate a recorded number of them. The
number SHALL be documented in `docs/quality.md`, SHALL NOT be raised, and SHALL be lowered as
errors are fixed.

#### Scenario: ErrorsAboveCeilingFail
- **GIVEN** a suite with a recorded ceiling of N type errors
- **WHEN** a change brings it to N + 1
- **THEN** the type check fails

#### Scenario: FixedErrorsMustLowerCeiling
- **GIVEN** a suite with a recorded ceiling of N type errors
- **WHEN** a change brings it below N without lowering the ceiling
- **THEN** the type check fails and asks for the ceiling to be lowered

#### Scenario: NoCeilingOnceClean
- **GIVEN** a suite whose type errors reached zero
- **WHEN** `npm run typecheck` runs
- **THEN** the suite is checked with no tolerance, and `docs/quality.md` records no ceiling for it
