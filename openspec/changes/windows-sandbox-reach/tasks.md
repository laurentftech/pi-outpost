# Tasks

- [x] 1. Reproduce #553 and #552 under MXC on Windows 11 24H2 (`design.md`, Measured).
- [x] 2. `ancestorsToEnumerate` and `processContainer.filesystem.enumeratePaths` in `mxcTerminalConfig`, what lies beside denied by name (`deniableEntries`), off where MXC's probe says it cannot enumerate; carried to the SDK (`server/src/mxcSdk.ts`) and kept by a diagnosis.
- [x] 3. `sandbox.privateNetwork` (`server/src/config.ts`), the request's `ingress` (`mxcTerminalConfig`), passed by the agent's shell and the terminal (`sandbox.ts`, `confinementStatus.ts`, `index.ts`, kept across a Settings apply); the startup line says when it is closed.
- [x] 4. The note on a refused connection (`reportsSocketRefused`, `socketRefusedNote`, `server/src/confinedBash.ts`).
- [x] 5. The user's proxy variables (`userProxyEnvironment`), none with credentials (`proxyCredentialsLeftOut`, on the startup line), none under `allowedHosts`; the terminal's too.
- [x] 6. scoop's shims outside the home followed (`toolInstallations`).
- [x] 7. Tests: `server/test/windowsSandboxReachMxc.test.ts` (real MXC), `terminalSandbox.test.ts`, `mxcSdk.test.ts`, `config.test.ts`, `landstripNotes.test.ts`, `socketRefused.test.ts`, `confinedBash.test.ts`, `toolInstallations.test.ts`.
- [x] 8. Docs: `docs/sandboxing.md`, `docs/configuration.md`.
