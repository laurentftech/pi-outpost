# Tasks

- [x] 1. `ancestorsToEnumerate` (`server/src/terminalSandbox.ts`): include the root of a drive other than the root's in its output.
- [x] 2. `mxcTerminalConfig`: move every path on a foreign drive (that drive's root and the enumerated ancestors of the tools on it) from `enumeratePaths` to `readonlyPaths`.
- [x] 3. Tests: `server/test/terminalSandbox.test.ts` — `AToolOnAnotherDriveThanTheRootsResolves` (root on `C:`, scoop on `D:` with `current` junction and `node.exe` at the target's root; way down readable, link never enumerated, target readable, beside-the-way contents protected) and the updated `ancestorsToEnumerate` expectation.
- [x] 4. Real-MXC e2e on this machine against a second drive letter (subst `D:`): before the fix `Get-Command node` fails and `node -v` is refused without a grant (reproduces #572), with the fix `node` resolves through `current` and runs at every enumeration level; with a grant it worked before too.
- [x] 5. `npx tsc --noEmit -p server/tsconfig.test.json`, `oxlint`, the `terminalSandbox`/`terminalSandboxMxc`/`toolInstallations`/`sandbox`/`landstripNotes` suites, and `npx openspec validate windows-sandbox-second-drive --strict`.
