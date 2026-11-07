# Scenario coverage

Scenario inventory: `rg '^#### Scenario:' openspec/`. This capability has no existing main
spec; all eleven scenarios are in this change's delta.

| Scenario | Status | Evidence |
| --- | --- | --- |
| IllTypedUiTestFailsTypecheck | covered | `scripts/test-typecheck.test.mjs`, UI “an ill-typed new test file fails the suite's check without any configuration edit”: nonzero compiler exit, diagnostic names the probe, excluded probe negative control; exact script wiring is checked. |
| IllTypedServerTestFailsTypecheck | covered | Same test, server configuration and directory. |
| IllTypedEndToEndSpecFailsTypecheck | covered | Same test, e2e configuration and directory. |
| EveryRunTestFileIsChecked | covered | `scripts/test-typecheck.test.mjs`, “EveryRunTestFileIsChecked: no tracked test source is missing from its configuration” compares `git ls-files` with actual `tsc --listFilesOnly`; “…and the comparison does notice a file a configuration leaves out” verifies an exclusion is detected. |
| NewTestFileIsCheckedWithoutConfiguration | covered | `scripts/test-typecheck.test.mjs`, server “an ill-typed new test file fails the suite's check without any configuration edit” writes the probe into the real included directory, then removes it in `finally`. |
| PullRequestWithIllTypedTestIsRed | partial | Pending a deliberately ill-typed throwaway PR and observed failures of `check` and `CI ok`; `.github/workflows/ci.yml` runs the root typecheck on both platforms. |
| IgnoreCommentInTestIsRefused | covered | `scripts/test-typecheck.test.mjs`, “IgnoreCommentInTestIsRefused: `@ts-ignore` and `@ts-nocheck` fail the lint and are named” checks exit code, rule and file name for every suite, using the root lint configuration. |
| UnexplainedExpectErrorIsRefused | covered | `scripts/test-typecheck.test.mjs`, “UnexplainedExpectErrorIsRefused, while a described one is allowed” checks refusal plus the explanation diagnostic, and acceptance of a described intentional error. |
| ErrorsAboveCeilingFail | covered | No transitional ceiling is used: the condition of a recorded N-error allowance is inapplicable. All three compiler-probe tests above reject even one new error; “NoCeilingOnceClean: every suite uses the compiler directly, with no transition ceiling” prevents introducing tolerance. |
| FixedErrorsMustLowerCeiling | covered | No transitional ceiling exists, so this conditional scenario is inapplicable. `scripts/test-typecheck.test.mjs`, “NoCeilingOnceClean: every suite uses the compiler directly, with no transition ceiling” forbids both ceiling files; exact script checks prevent adding a tolerance wrapper. This is not a claim to have tested a ceiling implementation. |
| NoCeilingOnceClean | covered | `scripts/test-typecheck.test.mjs`, “NoCeilingOnceClean: every suite uses the compiler directly, with no transition ceiling”, checks absent ceiling files, exact direct compiler commands and the zero-tolerance documentation. |

Validation results and the CI negative-control link will be added after the runs finish.
