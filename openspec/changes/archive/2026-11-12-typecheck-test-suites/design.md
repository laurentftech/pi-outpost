# Design

## Context

See proposal.md for motivation. State of `main` (28a7d1c), measured 2026-11-07:

| Suite | TS test files | Type-checked today | Errors if checked |
|---|---|---|---|
| `ui` (Vitest) | 132 under `src/` | no: `ui/tsconfig.json` is strict and includes `src`, tests included, but `ui` has no `typecheck` script; shipped `ui` code is checked only through `web`/`embed` imports | ~74, all in tests |
| `server` (`node --test` + `tsx`) | 213 under `test/` (+100 `.mjs`) | no: `server/tsconfig.json` includes `src` only | ~76 in 34 tests + 1 fixture; 13 are TS7016 (untyped `.mjs` import) |
| `e2e` (Playwright) | 42 | no: not a workspace, no `tsconfig.json` | ~12 in 6 specs + 2 support files |
| `office`, `openwebui`, `posters`, `mcp` | 27 | yes: their `tsconfig.json` includes `test` | 0 |

Counts were taken on a checkout carrying unrelated in-progress `ui` work; re-measure before
starting.

Other facts that shape the approach:

- Root `typecheck` is `npm run typecheck --workspaces --if-present`; CI's `check` job runs it on
  Ubuntu and Windows, for every PR that is not documentation-only (`CI ok` is required on `main`).
- `server` lint is `oxlint src --max-warnings 43`: it does not see `server/test`. `ui` lint covers
  `src` (tests included). Nothing lints `e2e`.
- Every existing `@ts-expect-error` in tests (9 in `e2e`, 1 in `server/test`) exists to import the
  untyped `server/test/harness.mjs`.
- `e2e` imports are extensionless (`../ui/src/export/testImages`); Playwright transpiles them.

## Goals / Non-Goals

**Goals:**

- Each TypeScript test file CI runs is checked under the same strictness as the code it tests,
  through `npm run typecheck`, so existing CI enforces it (spec: TestSourcesAreTypeChecked,
  TypeErrorsBlockMerging).
- Coverage follows the file tree, not a hand-kept list (spec: NoTestSourceEscapesTheCheck).
- Errors are fixed by reading the test, and the fixes do not hide anything
  (spec: TypeErrorsAreNotSilenced).

**Non-Goals:**

- Type-checking JavaScript tests (`server/test/*.mjs`, `scripts/*.test.mjs`) with `checkJs`.
  Possible follow-up once this lands.
- Changing test runners, or making Vitest/`tsx` type-check at run time (slower, and duplicates
  `tsc`).
- Banning `as` casts mechanically. Casts stay a review matter (see Decisions → fixing errors).

## Decisions

### One configuration per suite, wired into the existing `typecheck`

- **ui**: add `"typecheck": "tsc --noEmit"`. The existing `tsconfig.json` already includes tests.
- **server**: add `tsconfig.test.json` extending `tsconfig.json`, including `src` and `test`
  (`*.ts`, not `.mjs`). `typecheck` runs it (a superset of `src`, so one `tsc` run).
- **e2e**: add `e2e/tsconfig.json` (strict, `moduleResolution: "Bundler"`, DOM + Node types,
  `noEmit`), matching how Playwright loads the specs. Extend the root script:
  `"typecheck": "npm run typecheck --workspaces --if-present && tsc -p e2e"`.

Alternative considered: one root `tsconfig` with project references over everything. Rejected
for now: it changes how every workspace builds, for no gain over per-suite configs.

Coverage by directory `include` (`src`, `test`, `**/*.ts`) satisfies "no hand-kept list": a new
file under a covered directory is checked automatically.

### Type the shared harness instead of suppressing its import

Add `server/test/harness.d.mts` declaring what `harness.mjs` exports (`startServer`, `connect`,
`makeWorkspace`, `freePort`, …), typed from how the tests use it. Then remove the
`@ts-expect-error` comments that only existed for it. This resolves the TS7016 group and gives
`e2e` and server tests real types for the harness.

Alternative: convert `harness.mjs` to TypeScript. Rejected here: 100 `.mjs` tests import it, and
that conversion is a separate change.

### Refuse silencing comments with a narrow lint step

Enable Oxlint's `typescript/ban-ts-comment` (`ts-ignore`/`ts-nocheck` banned,
`ts-expect-error` allowed with a description) on the test directories only, as its own step
(`oxlint -A all -D typescript/ban-ts-comment …`) so it does not pull every other rule onto
`server/test` and `e2e` at once. Hook it into the existing `lint` scripts so CI runs it.

A described `@ts-expect-error` stays legitimate where a test deliberately sends a value of the
wrong type to exercise runtime validation (e.g. a malformed wire message).

### Fixing errors: classify, then fix what the test claims

For each error, decide which of these it is and fix accordingly:

1. **Stale test**: the test reads or sends something that no longer exists (e.g. `ui`'s
   `useAgent.test.ts` reading `progress` on `ChatItem`). Rewrite the assertion against current
   behaviour, then check it can fail: break the behaviour locally (or revert the fix under test)
   and see the test go red. If the behaviour it targeted is gone, remove the test.
2. **Fake drift**: a mock or fixture no longer matches the real type. Type the fake from the real
   type (`satisfies`, or the real interface) so the next drift is a compile error. This is the
   "a fake is kinder than reality" failure in CLAUDE.md.
3. **Missing types**: untyped imports (`.mjs` helpers, third-party test utilities). Add
   declarations.
4. **Strictness noise**: possibly-null access, implicit `any` in callbacks. Narrow or annotate.

Record every test found to prove nothing (category 1 where the assertion could not fail) in
`openspec/changes/typecheck-test-suites/findings.md`, with the file, the test name and what it
now asserts or why it was removed.

### Roll out suite by suite; ceiling only as a fallback

Preferred: wire a suite into `typecheck` in the same PR that takes it to zero. Order: `server`
(no concurrent work; the harness declaration also unblocks `e2e`), then `e2e`, then `ui` after
the in-flight `ui` work (#438) is merged, to avoid conflicting edits.

Fallback, if a suite cannot reach zero in one PR: a ceiling check script
(`scripts/check-type-ceilings.mjs`) runs that suite's `tsc --pretty false`, counts `error TS`
lines, and compares with `scripts/type-ceilings.json`. It fails above the ceiling and also below
it, asking for the ceiling to be lowered (spec: TransitionCeilingOnlyDecreases). It invokes the
TypeScript compiler through `node` and `require.resolve("typescript/bin/tsc")`, not `npx`, so it
spawns correctly on Windows. Remove the script and its JSON once every ceiling is zero.

### Proving coverage

Add a script test (run by `npm run test:scripts`, already in CI) that, for each suite, compares
`git ls-files` TypeScript test files with the configuration's `tsc --listFilesOnly` output and
fails on any file not listed (spec: EveryRunTestFileIsChecked). Positive/negative scenarios
(ill-typed test fails, new file checked without configuration, ts-ignore refused) are proven by
fixture-based script tests that run `tsc`/Oxlint on a temporary ill-typed file.

## Risks / Trade-offs

- [Type check time in CI grows] → One extra `tsc` per suite inside the existing `check` job;
  measure before/after and record it in the PR. `skipLibCheck` stays on.
- [A "fix" that makes the type error disappear but leaves the test meaningless] → The
  classification rule and the must-be-able-to-fail check; findings recorded for review.
- [Conflicts with concurrent `ui` work] → `ui` last, after #438 merges; re-measure first.
- [Windows-only type differences (paths, CRLF fixtures)] → CI type-checks on Windows too; build
  expected paths with `path.join`, per CLAUDE.md.
- [Fixture-based tests of the type check are slow] → Keep fixtures tiny, one `tsc` invocation
  per scenario, in `test:scripts` (Ubuntu only).

## Migration Plan

Each suite lands in its own PR (server, e2e, ui), each green on Ubuntu and Windows. Rollback is
removing that suite from `typecheck`; tests keep running either way. Documentation
(`docs/quality.md`, `CONTRIBUTING.md`) is updated in the PR that brings the first suite in, and
the last PR removes any ceiling text.
