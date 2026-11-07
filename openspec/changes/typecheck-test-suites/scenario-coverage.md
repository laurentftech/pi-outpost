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
| PullRequestWithIllTypedTestIsRed | covered | Disposable [PR #446](https://github.com/laurentftech/pi-outpost/pull/446), closed unmerged. [CI run](https://github.com/laurentftech/pi-outpost/actions/runs/42396000379): `check (ubuntu-latest)` failed at `npm run typecheck`, naming `test/typecheck-ci-negative.test.ts(3,13)` and TS2345 (`string` is not assignable to `GitRepo`); the [CI ok job](https://github.com/laurentftech/pi-outpost/actions/runs/42396000379/job/128476977123) failed. The Windows matrix leg was cancelled by fail-fast. |
| IgnoreCommentInTestIsRefused | covered | `scripts/test-typecheck.test.mjs`, “IgnoreCommentInTestIsRefused: `@ts-ignore` and `@ts-nocheck` fail the lint and are named” checks exit code, rule and file name for every suite, using the root lint configuration. |
| UnexplainedExpectErrorIsRefused | covered | `scripts/test-typecheck.test.mjs`, “UnexplainedExpectErrorIsRefused, while a described one is allowed” checks refusal plus the explanation diagnostic, and acceptance of a described intentional error. |
| ErrorsAboveCeilingFail | covered | No transitional ceiling is used: the condition of a recorded N-error allowance is inapplicable. All three compiler-probe tests above reject even one new error; “NoCeilingOnceClean: every suite uses the compiler directly, with no transition ceiling” prevents introducing tolerance. |
| FixedErrorsMustLowerCeiling | covered | No transitional ceiling exists, so this conditional scenario is inapplicable. `scripts/test-typecheck.test.mjs`, “NoCeilingOnceClean: every suite uses the compiler directly, with no transition ceiling” forbids both ceiling files; exact script checks prevent adding a tolerance wrapper. This is not a claim to have tested a ceiling implementation. |
| NoCeilingOnceClean | covered | `scripts/test-typecheck.test.mjs`, “NoCeilingOnceClean: every suite uses the compiler directly, with no transition ceiling”, checks absent ceiling files, exact direct compiler commands and the zero-tolerance documentation. |

Local validation: full typecheck, build and lint pass; the 16 compiler/inventory/lint
proofs and the additional before-build embed resolution regression pass. The clean UI
suite passes 135 files / 2,673 tests. Targeted Playwright passes 33 scenarios against
the built application, including repeated reload/session changes, stale embeds, foreign
origins, refusal/approval, and rapid actions while repository inventory changes.

Stale-assertion negative controls used temporary module/test copies, never weakened
production code: enabling optional Git locks fails the index-mtime assertion; treating
a tool result as the assistant's reply fails `assistant: Done!`; forcing a confirmation
to false fails the exact outbound frame assertion; inventing zero progress for a
text-only update fails the undefined-progress assertion. All temporary copies were removed.

CI timing comparison, same-day Ubuntu `check` job: the typecheck step rose from 29 s
([baseline run](https://github.com/laurentftech/pi-outpost/actions/runs/42387788002)) to
63 s ([implementation run](https://github.com/laurentftech/pi-outpost/actions/runs/42396512431)).
Windows rose from 45 s to 52 s. These are single-run measurements, not benchmark averages.
