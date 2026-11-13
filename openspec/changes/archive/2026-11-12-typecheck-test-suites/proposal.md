# Proposal

## Why

`npm run typecheck` checks the shipped code but not most of the tests. Vitest (UI) and `tsx`
(server, e2e) strip types without checking them, so an ill-typed test still runs — and a type
error in a test usually means it reads something that no longer exists, so it may pass while
proving nothing. Measured on 2026-11-07: about 74 errors in `ui` tests, 76 in `server` TypeScript
tests and 12 in `e2e`, none of them visible to CI. The project tells contributors and its
OpenSSF Best Practices entry that TypeScript is strict; today that holds for the product, not for
the evidence that the product works.

## What Changes

- Every TypeScript test file in a suite CI runs — `ui/src/**/*.test.ts(x)`,
  `server/test/**/*.ts`, `e2e/**/*.ts` — is type-checked by `npm run typecheck`, which CI already
  runs on every pull request that is not documentation-only.
- `ui` gains a `typecheck` script over its existing strict `tsconfig.json` (which already includes
  its tests). `server` gains a test type-check configuration covering `test/`. `e2e` gains a
  `tsconfig.json` and a `typecheck` entry point. `office`, `openwebui`, `posters` and `mcp`
  already include `test/` and are unchanged.
- Each existing error is resolved by reading the test: fix the test so it asserts what it claims,
  fix a stale fixture or helper type, or add a declaration for an untyped `.mjs` helper. A cast,
  `any`, `@ts-ignore` or `@ts-expect-error` used only to silence an error is not a resolution.
  A test found to prove nothing is repaired or removed, and the finding is recorded.
- During the transition, a per-suite ceiling on the error count may be enforced instead of zero.
  The ceiling only goes down, is recorded in `docs/quality.md` like the lint-warning ceiling, and
  is removed when it reaches zero.
- `docs/quality.md` and `CONTRIBUTING.md` state that tests are type-checked.

Out of scope: type-checking JavaScript tests (`*.test.mjs`, `scripts/*.test.mjs`) with
`checkJs`. They are listed in the design as a possible follow-up.

## Capabilities

### New Capabilities

- `test-type-checking`: which test sources the repository type-checks, how the check runs in
  CI, and how existing errors may be carried while they are being fixed.

### Modified Capabilities

None.

## Impact

- `ui/package.json`, `server/package.json` (+ a test `tsconfig`), new `e2e/tsconfig.json`, root
  `package.json` `typecheck` script if `e2e` is not a workspace.
- Test files and fixtures across `ui/src`, `server/test`, `e2e` (about 40+ files with errors).
- Possibly small `.d.ts` declarations for `server/test/*.mjs` helpers imported from TypeScript.
- `docs/quality.md`, `CONTRIBUTING.md`; the OpenSSF Best Practices answers that mention strict
  TypeScript become true for tests too.
- No product behaviour, API or dependency change. CI time grows by the extra `tsc` runs inside
  the existing `check` job.
- `ui/` is being changed concurrently by the file-tree actions work (#438): rebase on `main` and
  re-measure before fixing `ui` tests, to avoid conflicting edits.
