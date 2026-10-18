# On Linux, MXC may confine the agent's shell, beside landstrip

## Why

On Linux pi-outpost runs in Docker and confines the agent's shell with landstrip (Landlock and
seccomp), which works under Docker's default profile. Two things it does not give:

- **The network.** `sandbox.allowedHosts` (change `mxc-network-allowlist`) needs MXC; on Linux the
  shell's network stays open.
- **The server's processes.** A confined command runs as the same account and can read the
  server's environment through `/proc/<pid>/environ` — documented in `docs/sandboxing.md`.

`@microsoft/mxc-sdk`, already installed with pi-outpost, ships MXC's Linux executor (`bin/x64/lxc-exec`,
`bin/arm64/lxc-exec`) with a Bubblewrap backend driven by the same JSON request as `wxc-exec.exe`.
The cost is the outer container's hardening, which is why a bubblewrap runner was declined on
2026-10-10: this is an option for a deployment that accepts it, not a replacement for landstrip.

## Measured

Docker Desktop 29.8.2 (WSL2 kernel, cgroup v2), `node:22-bookworm` with `bubblewrap`, `slirp4netns`,
`iptables` and `curl` installed, MXC 1.0.1's `lxc-exec`, user `node`, one request per command:

| Docker options | Result |
|---|---|
| defaults | refused, with MXC's reason: "unprivileged user and network namespaces, which this host refused … AppArmor" |
| `--security-opt seccomp=unconfined --security-opt apparmor=unconfined` | confined, network closed; any `network.egress` rule refused: slirp4netns needs `/dev/net/tun` |
| … `--device /dev/net/tun` | everything below works; `--security-opt no-new-privileges` too |

Under the last line:

- A file beside the root and the denied agent directory: "No such file or directory". A write in the
  root lands on the host; one beside it does not. No key in the command's environment. `git init`
  and `rev-parse` work.
- The command sees 6 processes, PID 1 being `bwrap`: the server is not among them. (The runner's own
  environment is visible as `bwrap`'s, so it must stay the minimal one pi-outpost already hands it.)
- No `network` field: no network at all. `egress: allow`: registry.npmjs.org and example.com 200.
  `egress: deny`: DNS and connections refused.
- `egress: deny`, `ingress: deny` and `runtimeConfig.networkProxy` at a proxy on the container's
  loopback: MXC rewrites `HTTPS_PROXY` to `http://10.0.2.2:<port>/` (slirp's host address); an allowed
  host is relayed (200), another refused by the proxy, `curl --noproxy` refused, another service on the
  loopback unreachable. Unlike Windows, Bubblewrap *refuses* `ingress.default: "allow"` with a proxy.
- The LXC backend asks for a distribution to download (`"distribution": "alpine", "release": "3.23"`);
  not pursued.
- Not measured: an interactive terminal (a pty) through `lxc-exec`.

## What Changes

- `"mxc"` resolves on Linux to the installed package's `bin/<arch>/lxc-exec`; a path whose file is
  `lxc-exec` names MXC too. Accepted as `sandbox.bashRunner` and `terminal.sandbox`.
- The self-check on Linux runs one confined `/bin/true` with the network shape the configuration
  asks for, and refuses the runner with MXC's own reason when the host cannot (namespaces, AppArmor,
  `/dev/net/tun`, a missing `bwrap`, `slirp4netns` or `iptables`).
- The request: `containment: "bubblewrap"`; the root writable or read-only as today, the command's
  temporary folder writable, the system trees and the shell's folder read-only, the user's git
  configuration read-only, the agent directory and the configuration file denied; the minimal
  environment, for the command and for the runner.
- The network: open (`egress: allow`) by default, as landstrip leaves it. Under `sandbox.allowedHosts`,
  `egress: deny`, `ingress: deny` and the server's proxy — the same proxy, the same refusal note.
- The terminal panel under MXC on Linux, if a pty works through `lxc-exec`; otherwise the terminal is
  refused with the reason and only the agent's shell takes MXC (decided by the first implementation
  task).
- `docs/sandboxing.md`: the option, its Docker flags and packages, and the trade-off against
  landstrip; README configuration rows.

## Out of scope

- Replacing landstrip, which stays the recommended Linux runner.
- A seccomp profile narrower than `unconfined` that only lets the namespace calls through: worth a
  later change, once the calls are known.
- MXC's LXC and microVM backends; macOS (`mxc-exec-mac`, Seatbelt).

## Impact

`server/src/mxcExecutor.ts` (per-platform executor name), `server/src/terminalSandbox.ts`
(`runnerKind`, the Linux self-check, the Bubblewrap request), `server/src/confinedBash.ts`,
`server/src/config.ts` (accept MXC on Linux), the terminal manager if the pty works, docs.
Depends on `mxc-network-allowlist` for `sandbox.allowedHosts` and the proxy.
