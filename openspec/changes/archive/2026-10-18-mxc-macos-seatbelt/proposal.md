# On macOS, MXC may confine the agent's shell and the terminal

## Why

On macOS pi-outpost has no sandbox runner: `docs/sandboxing.md` says "untested", and the agent's
`bash` and the terminal run with every right of the server's account. landstrip is Linux only.

`@microsoft/mxc-sdk`, already an optional dependency, ships MXC's macOS executor (`bin/arm64/mxc-exec-mac`,
signed, hardened runtime) with a Seatbelt backend driven by the same JSON request as `wxc-exec.exe` and
`lxc-exec`. Seatbelt is part of macOS: unlike Linux, nothing has to be loosened to use it. It ships for
Apple silicon only.

## Measured

Apple M1, macOS 15.6.1, MXC 1.0.1's `mxc-exec-mac`, `containment: "seatbelt"`, the request shape of
`mxcLinuxConfig` (root read-write, system trees read-only, a folder denied), one request per command,
2026-10-18 (`scripts/probes/mxc-macos-seatbelt.sh`, `mxc-macos-seatbelt-2.sh`):

- A file beside the root and one in the denied folder: "Operation not permitted". A write in the root
  lands on the host; one beside it is refused.
- `ps` is refused outright; `kill -0` and `kill -TERM` against another process of the same user are
  refused and the process lives. (landstrip on Linux lets a command signal the server.)
- No key in the command's environment: it gets the request's `env` only.
- `egress: allow`: example.com 200. `egress: deny`, or no `network` field: no network (curl exit 6).
- The executor on a pty, as pi-outpost's terminal spawns it, running `bash --norc -i`: the pty's size
  (40×120) reaches the shell, Ctrl-C interrupts `sleep` (130) without ending the shell. `tty` answers
  "not a tty" (the device name is not readable), cosmetic.
- `git` is Apple's `xcrun` shim: it needs the developer directory (`xcode-select -p`) readable, and
  even then it warns on every call (no `DARWIN_USER_TEMP_DIR`, `/tmp` not writable) and leaves a
  `Library/` cache folder in `HOME`. It answers correctly (`rev-parse`, `status`).
- `egress: deny` with `runtimeConfig.networkProxy` at a CONNECT proxy on the loopback
  (`mxc-macos-seatbelt-proxy.sh`): MXC sets `HTTP(S)_PROXY`/`ALL_PROXY` to the proxy's own address;
  the listed host is relayed (200), an unlisted one refused by the proxy (403), the listed host with
  `--noproxy` refused (curl 6), another service on the loopback unreachable (curl 7). Unlike Bubblewrap,
  `ingress: allow` beside the proxy is accepted too; `ingress: deny` is enough.
- Not measured: an Intel Mac (no executor).

## What Changes

- `"mxc"` resolves on macOS to the installed package's `bin/arm64/mxc-exec-mac`; a path whose file is
  `mxc-exec-mac` names MXC too. On an Intel Mac `"mxc"` is refused naming the architecture.
- The macOS self-check runs one confined `/usr/bin/true` with the network shape the configuration asks
  for and refuses the runner with MXC's own reason.
- The request: `containment: "seatbelt"`, the root writable or read-only as today, the command's
  temporary folder writable, the system trees, the search path's installations, the shell's folder and
  the developer directory read-only, the user's git configuration read-only, the agent directory and the
  configuration file denied; `TMPDIR` and `HOME` such that git's shim neither warns nor writes in the
  root. The minimal environment, for the command and for the executor.
- The network: open by default; under `sandbox.allowedHosts`, `egress: deny`, `ingress: deny` and the
  server's proxy — the same proxy and refusal note as Windows and Linux.
- The terminal panel under MXC on macOS (pty measured working).
- `docs/sandboxing.md`: a *macOS: MXC* section replacing "untested"; README rows.
- Real-executor tests, and a CI job on `macos-latest` (Apple silicon) running them.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `sandbox-runner-bash`: `"mxc"` names the macOS executor; its commands keep the limits of a confined
  command; an architecture that cannot run it is refused; the network follows `allowedHosts`.
- `terminal`: the terminal may run under MXC on macOS.

## Impact

`server/src/mxcExecutor.ts` (platform → executor, arm64 only on macOS), `server/src/terminalSandbox.ts`
(`runnerKind`, self-check, a Seatbelt request builder), `server/src/confinedBash.ts`,
`server/src/index.ts` (`terminalConfinement`), `server/src/config.ts` (`bashImage` refused on macOS),
`server/src/buildExe.ts` if the macOS executable should carry it, tests, `.github/workflows/ci.yml`,
`docs/sandboxing.md`, `README.md`. Stacked on `mxc-linux-bubblewrap` (PR #328), whose per-platform
executor lookup it extends.
