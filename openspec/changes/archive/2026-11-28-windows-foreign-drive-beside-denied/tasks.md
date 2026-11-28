# Tasks

- [x] 1. `mxcTerminalConfig` (`server/src/terminalSandbox.ts`): keep the foreign way-down in `foreignWay`, compute `besideTheWay` over enumerated + foreign folders, skip system folders at drive roots.
- [x] 2. Unit test `BesideTheForeignWayDownStaysDenied` in `server/test/terminalSandbox.test.ts`.
- [x] 3. Real-MXC regression test `server/test/confinementCanaryMxcForeignDrive.test.ts` (canary with root and system temp on different drives; needs `MXC_EXEC`).
- [x] 4. CI: `mxc-windows` job on `windows-11-arm` in `.github/workflows/ci.yml` + `scripts/mxc-windows/test.ps1`, wired into `ci-ok`.
- [x] 5. `docs/sandboxing.md`: one sentence — on another drive, the way down is readable and what lies beside it stays denied by name.
- [x] 6. `npx tsc --noEmit -p server/tsconfig.test.json`, `oxlint`, the `terminalSandbox`/`confinementCanary` suites, `npx openspec validate windows-foreign-drive-beside-denied --strict`, `node scripts/check-scenario-coverage.mjs --change windows-foreign-drive-beside-denied`.
