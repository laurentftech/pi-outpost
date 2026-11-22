# Tasks

- [x] 1. Probe each runner for a read-only directory inside the writable root (MXC on Windows, Linux, macOS; landstrip; Seatbelt), and for a `.git` created during the session. Record the answers in design.md before any code.
- [x] 2. The policy builders in `server/src/terminalSandbox.ts` hold `<root>/.git` read-only where the runner can; a runner that cannot says so at its check.
- [x] 3. The confinement canary tries to write `<root>/.git/config` in a scratch repository.
- [x] 4. The grant dialog's sentence for a grant on `.git`; the refusal note points at `run_with_grant`.
- [x] 5. `sandbox.gitWritable` (file only).
- [x] 6. Tests per runner (real executors where CI has them: MXC on Linux and macOS, Seatbelt); the running app for the commit grant.
- [x] 7. Docs: `docs/sandboxing.md`, `docs/configuration.md`.
