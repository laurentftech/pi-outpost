## 1. Feasibility

- [x] 1.1 Measure `mxc-exec-mac` on Apple silicon: filesystem, processes, signals, network open and closed, a pty, git (proposal, Measured).
- [x] 1.2 Measure the `sandbox.allowedHosts` shape (egress deny, proxy) under Seatbelt.

## 2. Resolution and configuration

- [x] 2.1 `mxcExecutorName("darwin")` → `mxc-exec-mac`; `bundledMxcExecutor` finds it in `bin/arm64` only; the Intel-Mac refusal names the architecture.
- [x] 2.2 `runnerKind` treats a path ending in `mxc-exec-mac` as MXC; `isMacMxc` beside `isLinuxMxc`.
- [x] 2.3 `config.ts`: `bashImage` refused with the macOS executor; `allowedHosts` accepted with it.

## 3. The Seatbelt request and the self-check

- [x] 3.1 `mxcMacConfig`: macOS system trees, search-path installations, the developer directory, the shell's folder, root/temp writable or zoned, agent dir and config denied, real paths, open network or the proxy shape.
- [x] 3.2 The confined search path puts the real git's folder ahead of `/usr/bin` (the `xcrun` shim never runs).
- [x] 3.3 `checkMacMxcRunner`: one confined `/usr/bin/true`, MXC's reason on refusal; `mxc-exec-mac` refused off macOS.

## 4. Wiring

- [x] 4.1 The agent's `bash` under the macOS executor (`confinedBash.ts`).
- [x] 4.2 The terminal under it (`index.ts` `terminalConfinement`); `getCwd` finds the shell under the executor on macOS (process tree measured on the real executor).

## 5. Tests

- [x] 5.1 Unit tests: resolution, `runnerKind`, config refusals, `mxcMacConfig` (paths, network shapes), the check's reason.
- [x] 5.2 Real-executor tests skipped unless `MXC_MAC_EXEC` names an executor: the agent's `bash` (reads, writes, signal, key, git quiet, network open, allowedHosts) and the terminal (git, key, size and resize, Ctrl-C, cwd).
- [x] 5.3 Run them on an Apple-silicon Mac (`scripts/mxc-macos/test.sh`): CI's `macos-latest` runner, 6/6.
- [x] 5.4 CI job `mxc-macos` on `macos-latest` running the real-executor tests.

## 6. Documentation and checks

- [x] 6.1 `docs/sandboxing.md`: *macOS: MXC* section, the recommended-setup row, allowedHosts wording; README rows (`sandbox.bashRunner`, `terminal.sandbox`, `sandbox.allowedHosts`, MXC section).
- [x] 6.2 Running-app check on the Apple-silicon Mac: the agent's shell and the terminal under `"mxc"`, read back from the transcript and the DOM; a monkey pass on the terminal.
- [x] 6.3 `scenario-coverage.md`, `openspec validate --strict`, `check:scenarios`, typecheck, lint.

## After merge

- Archive the change from `main` (not from the feature branch).
