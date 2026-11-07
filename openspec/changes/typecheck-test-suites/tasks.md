# Tasks

Each group is meant to land as its own pull request, green on Ubuntu and Windows. Work in a
separate worktree or branch, not in a checkout another agent is using. Re-measure each suite's
error count on current `main` before starting its group (the counts in design.md are from
2026-11-07).

## 1. Proof tooling (no suite enabled yet)

- [ ] 1.1 Add a script test, run by `npm run test:scripts`, that for a given suite configuration lists the files `tsc --listFilesOnly` includes and fails when a tracked TypeScript test file of that suite (`git ls-files`) is missing; verify it fails on a deliberately excluded file and passes otherwise
- [ ] 1.2 Add fixture-based script tests that write a tiny ill-typed test file into a temporary copy of a suite configuration and assert `tsc` exits non-zero naming that file; verify each fails if the configuration stops including the file
- [ ] 1.3 Add the narrow lint step (`typescript/ban-ts-comment`: `ts-ignore`/`ts-nocheck` banned, described `ts-expect-error` allowed) over `ui/src`, `server/test` and `e2e`, hooked into the existing `lint` scripts; add fixture tests proving `// @ts-ignore` and an undescribed `// @ts-expect-error` make `npm run lint` fail (scenarios IgnoreCommentInTestIsRefused, UnexplainedExpectErrorIsRefused); verify `npm run lint` passes on `main`'s current tests

## 2. Server tests

- [ ] 2.1 Add `server/test/harness.d.mts` typing the exports of `harness.mjs` from how the tests use them; remove the `@ts-expect-error` comments that only existed to import it (server and e2e); verify the TS7016 errors are gone and the removed comments do not become "unused directive" errors
- [ ] 2.2 Add `server/tsconfig.test.json` (extends `tsconfig.json`, includes `src` and `test/**/*.ts`) and point `server`'s `typecheck` at it; verify with 1.1 that every `server/test/*.ts` file and `test/fixtures/*.ts` is listed
- [ ] 2.3 Fix every remaining server test type error using the classification in design.md; for each stale-test fix, show the test can fail by breaking the behaviour locally; record tests found to prove nothing in `findings.md`; verify `npm run typecheck --workspace server` exits 0 and `npm test --workspace server` still passes
- [ ] 2.4 Document in `docs/quality.md` (checks table and a short "Tests are type-checked" note) and `CONTRIBUTING.md` that test sources are type-checked and which suites are covered so far; verify the documented command runs as written

## 3. End-to-end specs

- [ ] 3.1 Add `e2e/tsconfig.json` (strict, `moduleResolution: "Bundler"`, DOM and Node types, `noEmit`) and extend the root `typecheck` script to run `tsc -p e2e`; verify with 1.1 that every `e2e/**/*.ts` file is listed
- [ ] 3.2 Fix every e2e type error with the same classification and findings rule; verify `npm run typecheck` exits 0 and the Playwright suite (`npm run test:e2e`, after `npm run build`) still passes
- [ ] 3.3 Update the suite list in `docs/quality.md`; verify it matches the configurations

## 4. UI tests (after the concurrent `ui` work, #438, is merged)

- [ ] 4.1 Rebase on `main`, re-measure `tsc -p ui/tsconfig.json`, and add `"typecheck": "tsc --noEmit"` to `ui/package.json`; verify with 1.1 that every `ui/src/**/*.test.ts(x)` file is listed
- [ ] 4.2 Fix every UI test type error with the same classification and findings rule, starting with `useAgent.test.ts` (the `progress` read on `ChatItem`); verify `npm run typecheck` exits 0, `npm test --workspace ui` passes, and the e2e/bench checks CLAUDE.md requires for UI-facing test changes still pass
- [ ] 4.3 Update the suite list in `docs/quality.md` to "all TypeScript test suites"; verify against the configurations

## 5. Ceiling fallback (only if a suite cannot reach zero in its own PR)

- [ ] 5.1 Add `scripts/check-type-ceilings.mjs` and `scripts/type-ceilings.json`: run the suite's compiler through `node` + `require.resolve("typescript/bin/tsc")`, count `error TS` lines, fail above the ceiling and below it with a "lower the ceiling" message; script tests prove ErrorsAboveCeilingFail and FixedErrorsMustLowerCeiling; record the ceiling in `docs/quality.md`
- [ ] 5.2 When the last ceiling reaches zero, delete the script and JSON and remove the ceiling text; verify NoCeilingOnceClean (the suite is in `typecheck` with no tolerance)

## 6. Integration

- [ ] 6.1 Open a throwaway PR that introduces one ill-typed line in a server test and confirm `check` and `CI ok` fail (scenario PullRequestWithIllTypedTestIsRed); close it unmerged and link the run in the final PR
- [ ] 6.2 Write `scenario-coverage.md` mapping every scenario in `specs/test-type-checking/spec.md` to its evidence; run `npm run check:scenarios` and `openspec validate typecheck-test-suites --strict`
- [ ] 6.3 Record CI type-check time before and after in the final PR, and update the OpenSSF Best Practices answers that mention strict TypeScript (`warnings_strict`) to say tests are included

## Workflow follow-up

- Archive the change once every group has merged and the scenario matrix is fully `covered`.
