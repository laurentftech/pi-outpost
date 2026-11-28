# Tasks

- [x] 1. `server/src/terminalSandbox.ts`: `strictlyDeniable`, `deniableEntries(dir, filter)`, `strictDenies` input + `mxcStrictDenies()`/`noteMxcStrictDenies()` module flag, final `deniedPaths` filter in strict mode.
- [x] 2. Retry loops in `server/src/confinedBash.ts` and `server/src/confinementStatus.ts`: after the enumeration levels, one strict rebuild on `isSecurityEnvironmentRefusal`.
- [x] 3. Unit test `StrictDeniesKeepOnlyOpenableEntries` in `server/test/terminalSandbox.test.ts`.
- [x] 4. `docs/sandboxing.md`: one paragraph — when the security environment cannot open a denied path, the deny list is pruned to what it can open.
- [x] 5. `npx tsc --noEmit -p server/tsconfig.test.json`, `oxlint`, the `terminalSandbox` suite, `npx openspec validate windows-strict-denies-on-security-environment-refusal --strict`, `node scripts/check-scenario-coverage.mjs --change windows-strict-denies-on-security-environment-refusal`.
