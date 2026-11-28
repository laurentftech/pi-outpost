# Tasks

- [x] 1. `mxcTerminalConfig` (`server/src/terminalSandbox.ts`): compute `wayDownAll` from shell + tools + grants at any level; take `foreignWay` from `wayDownAll`, not from `enumeratePaths`.
- [x] 2. Unit test `ForeignWayDownDeniedWithoutEnumeration` in `server/test/terminalSandbox.test.ts` (levels 1 and 2).
- [x] 3. `sandboxDoctor.ts`: `runtimePolicy` at `mxcEnumerateLevel()` + rendering line; relay probe URL stripped of whitespace.
- [x] 4. `docs/sandboxing.md`: the beside-denied rule holds whatever enumeration level the host proved.
- [x] 5. `npx tsc --noEmit -p server/tsconfig.test.json`, `oxlint`, the `terminalSandbox` suite, `npx openspec validate windows-foreign-drive-denied-at-every-level --strict`, `node scripts/check-scenario-coverage.mjs --change windows-foreign-drive-denied-at-every-level`.
