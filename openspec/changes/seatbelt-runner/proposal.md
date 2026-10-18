# On every Mac, Seatbelt may confine the agent's shell and the terminal

## Why

`mxc-macos-seatbelt` confines on Apple silicon only: MXC ships `mxc-exec-mac` for arm64, and its
package names no source to rebuild it. An Intel Mac — the developer's own iMac among them — keeps an
unconfined shell. Yet Seatbelt is in macOS on Intel too, and `mxc-exec-mac` is a thin layer over it:
`sandbox_init` with a profile it generates. `/usr/bin/sandbox-exec` applies such a profile on any Mac.

## Measured

`mxc-exec-mac --debug` prints the profile it generates (Apple M1, MXC 1.0.1, 2026-10-18): deny by
default; process fork and exec, signals to the same sandbox only, sysctl reads, file metadata, five
named Mach services; the system trees readable; `/dev/null`-style devices and the tty; the request's
read-only and read-write paths; network either open with the host loopback closed
(`(deny network-outbound (remote ip "localhost:*"))`) or closed but for the proxy's port
(`(allow network-outbound (remote ip "localhost:<port>"))`); window server, pasteboard and HID denied;
denied paths last.

The same profile, written by hand and applied with `/usr/bin/sandbox-exec -f` on an Intel iMac
(macOS 15.8, x86_64; `scripts/probes/seatbelt-sandbox-exec.sh`):

- A file beside the root and the denied agent folder: "Operation not permitted" (read, list). A write
  in the root lands; one beside it is refused and absent.
- `kill -0` on a process of the same user: refused, the process lives. `ps` cannot run (126).
- No key in the environment (the command gets the one it is given, `env -i`).
- git with the developer tools' folder first: Xcode's own, quiet, the root holds only `.git` and what
  the command made.
- Open network: example.com 200; another service on the loopback unreachable (curl 7).
- Closed but for one loopback port: example.com unreachable (curl 6), that port answers (200).
- An interactive bash on a pty, started in the root: `cd`, Ctrl-C (130), `exit`.
- A process started outside the root cannot read its own starting directory: the runner must start
  the command in the root, as pi-outpost already does.

## What Changes

- `"seatbelt"` as `sandbox.bashRunner` or `terminal.sandbox` names `/usr/bin/sandbox-exec`, accepted on
  macOS only (any architecture); a path whose file is `sandbox-exec` names it too.
- pi-outpost writes the Seatbelt profile from the configuration: the limits of `mxcMacConfig`, in the
  shape MXC generates. The command line and environment are pi-outpost's (`sandbox-exec` passes the
  environment through, so the runner is started with the minimal one).
- Self-check: one `/usr/bin/true` under a profile with the network rules a command gets.
- Network: open with the host loopback closed; under `sandbox.allowedHosts`, closed but for the
  server's proxy port, with `HTTP(S)_PROXY` set by pi-outpost (MXC set them itself).
- The terminal under it, with the macOS terminal's behaviour from `mxc-macos-seatbelt` (shell not a
  login shell, working directory from the runner's child).
- `docs/sandboxing.md` and README: macOS on Intel gets a runner; Apple silicon may use either.
- Real tests on the developer's Intel Mac and in CI on `macos-latest`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `sandbox-runner-bash`: a `"seatbelt"` runner on macOS, with the limits of a confined command and
  `sandbox.allowedHosts`.
- `terminal`: the terminal may run under it.

## Impact

`server/src/terminalSandbox.ts` (a Seatbelt profile writer, `runnerKind`, the check),
`server/src/confinedBash.ts`, `server/src/index.ts` (`terminalConfinement`), `server/src/config.ts`
(`"seatbelt"`, `allowedHosts` accepted with it, `bashImage` refused), `server/src/terminalManager.ts`
(the runner's child), tests, `.github/workflows/ci.yml`, `docs/sandboxing.md`, `README.md`. Stacked on
`mxc-macos-seatbelt` (PR #329).
