# Scenario coverage — sandbox-withholds-unconfined-builtins

Capability: `architecture` (1 modified requirement, `SecurityModel`). Only the new scenario is
changed in behaviour. The others are carried over unchanged with the requirement, and their
existing tests are unaffected.

## architecture

| Scenario | Coverage | Evidence |
| --- | --- | --- |
| UnconfinedBuiltInsAreNotRegistered | covered | `server/test/sandboxBuiltins.test.mjs`, a real server with `server/test/fixtures/activate-bash-extension.mjs`, which calls `setActiveTools` with `bash`, `powershell`, `write` and `edit` on `session_start`. "an extension cannot activate bash in a sandbox without it" asserts `bash` is neither active nor registered, `powershell` is not registered, and the sandbox's `read`/`write`/`edit`/`grep`/`find`/`ls` are active. "a read-only sandbox registers no write or edit" asserts `write`, `edit` and `bash` are neither registered nor active, and `read` is active. "allowBash supplies the sandbox's own bash" asserts the opt-in still works. Both of the first two tests failed before the fix (`bash` and `powershell` active; `write` registered read-only). `server/test/sandboxBuiltinGuard.test.ts` covers the fail-closed check: a session that still registers a built-in throws. |
| CrossOriginRejected | covered | `server/test/cors.test.mjs` — "an unknown origin gets no allow-origin header and keeps the same status". Unchanged by this change. |
| TokenRequired | covered | `server/test/files-raw.test.mjs` — "with a token configured, bytes need the token". Unchanged by this change. |
| SandboxedFileAccess | covered | `server/test/sandbox.test.ts` and `server/test/sandbox-tools.test.ts` — "refuses an absolute path outside the root". Unchanged by this change. |
| OpeningAWorkspaceUnderALock | covered | `server/test/multiProjectLifecycle.test.mjs` — "a pinned server refuses to open, close or switch". Unchanged by this change. |
| ANewWorkspaceIsSandboxedAtItsOwnRoot | covered | `server/test/multiProjectLifecycle.test.mjs` — the test whose name ends "inherits the server's sandbox". Unchanged by this change. |
| SessionsCannotBeOpenedAcrossWorkspaces | covered | `server/test/multiProjectWorkspaces.test.mjs` — "a session belonging to another project cannot be opened". Unchanged by this change. |
