## 1. Feasibility

- [x] 1.1 Capture MXC's generated Seatbelt profile (`mxc-exec-mac --debug`), open network and proxy.
- [x] 1.2 Apply the same profile with `/usr/bin/sandbox-exec` on an Intel Mac: filesystem, signals, key, git, network open and proxy-only, pty (`scripts/probes/seatbelt-sandbox-exec.sh`).

## 2. Configuration and kind

- [x] 2.1 `"seatbelt"` resolves to `/usr/bin/sandbox-exec` on macOS, refused elsewhere; `runnerKind` returns `seatbelt` for a `sandbox-exec` path.
- [x] 2.2 `allowedHosts` accepted with the Seatbelt runner; `bashImage` refused with it.

## 3. The profile and the check

- [x] 3.1 `seatbeltPolicy`: MXC's baseline, the paths from `mxcMacConfig`, network open (loopback closed) or proxy port only, UI denials, denied paths last; SBPL quoting.
- [x] 3.2 Proxy variables set in the command's environment under `allowedHosts`.
- [x] 3.3 The check: `/usr/bin/true` under the open-network profile; refused off macOS.

## 4. Wiring

- [x] 4.1 The agent's `bash` under the Seatbelt runner.
- [x] 4.2 The terminal under it; `getCwd` finds the shell (the runner's pid after exec).

## 5. Tests

- [x] 5.1 Unit tests: resolution and refusals, `runnerKind`, `seatbeltPolicy` (rules, order, quoting, network shapes), the check.
- [x] 5.2 Real tests where `SEATBELT_EXEC` is set on macOS: the agent's `bash` (reads, writes, signal, key, git, network open with loopback closed, allowedHosts) and the terminal (git in zsh, key, size, resize, Ctrl-C, cwd).
- [x] 5.3 Run them on the developer's Intel Mac, and in CI's `mxc-macos` job on Apple silicon.

## 6. Documentation and checks

- [x] 6.1 `docs/sandboxing.md` (setup rows for Intel and Apple silicon, a Seatbelt section, allowedHosts wording) and README rows.
- [x] 6.2 Running-app check on the Intel Mac: the agent's shell and the terminal under `"seatbelt"`, monkey pass.
- [x] 6.3 `scenario-coverage.md`, `openspec validate --strict`, `check:scenarios`, typecheck, lint.

## After merge

- Archive the change from `main`.
