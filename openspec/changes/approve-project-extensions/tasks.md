# Tasks

- [x] 1. `server/src/extensionApproval.ts`: list candidates without loading (pi's `resolve()` with packages withheld), hash them, read and write approvals in the server's per-project state.
- [x] 2. The runtime factory passes a `SettingsManager` whose project settings exclude what is not approved (`-<path>`, packages withheld).
- [x] 3. The question and its answer on the wire; allowing reloads the session.
- [x] 4. The dialog (path, "outside the sandbox", view code, allow, refuse) and the Settings list.
- [x] 5. Print mode: not loaded, named on stderr.
- [x] 6. Tests: each scenario, the confined write under MXC's real executor, and the running app with Playwright (monkey pass included).
- [x] 7. Docs: `docs/sandboxing.md` (extensions run outside the sandbox; the approval), changelog note on the one-time questions.
