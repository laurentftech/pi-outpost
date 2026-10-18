# Design

## Context

`mxc-macos-seatbelt` added `mxcMacConfig` (the request `mxc-exec-mac` turns into a Seatbelt profile),
the git-first search path, the non-login confined shell on macOS and `firstChildOnMac` for the
terminal's working directory. A runner is one of two kinds today (`RunnerKind`: `landstrip`, `mxc`),
chosen by its file name; `confinedBash.ts` and `terminalConfinement` branch on it, and each kind gets
its policy document written to a private temporary directory.

`/usr/bin/sandbox-exec -f <profile> <command…>` applies a Seatbelt profile and execs the command,
which keeps `sandbox-exec`'s environment and starting directory. Apple marks the tool deprecated in its
manual page; it ships and works on macOS 15 (Intel and Apple silicon), and other agent tools rely on it.

## Goals / Non-Goals

**Goals:**
- A runner for every Mac, with the limits `mxc-exec-mac` enforces and the same real tests.
- `sandbox.allowedHosts` under it.
- One source of truth for what a macOS command may touch: the profile is written from the same paths
  `mxcMacConfig` computes.

**Non-Goals:**
- Replacing MXC on Apple silicon: both stay; the configuration chooses.
- Linux or Windows: refused there.
- Profiles for tools beyond a shell's needs (GUI apps, Keychain, Apple Events): denied, as in MXC's.

## Decisions

**A third runner kind, `seatbelt`.** `runnerKind` returns `"seatbelt"` for a path whose file is
`sandbox-exec`; the bare word `"seatbelt"` resolves to `/usr/bin/sandbox-exec` (config, like `"mxc"`).
The spawn is `sandbox-exec -f <profile> <shell> <args…>`, started in the root with the minimal
environment — `sandbox-exec` hands the command its own environment and directory, so those are the
command's.

**The profile is MXC's shape, written by pi-outpost.** `seatbeltProfile(input)` takes `mxcMacConfig`'s
input and output — `readwritePaths`, `readonlyPaths`, `deniedPaths`, network — and renders the
baseline MXC generates (deny default; fork, exec, same-sandbox signals, sysctl reads, metadata, the
five Mach services; `/` readable as data; system trees; devices and ttys; pty allocation), then the
paths shallow to deep, the network rules, the UI denials, and the denied paths last so they override.
Paths are quoted as SBPL strings (backslash and double quote escaped). Alternative: a hand-tuned
profile of our own — rejected, MXC's is the measured, maintained shape and keeps both runners equal.

**Network.** Open: `(allow network-outbound) (allow network-bind (local ip)) (allow system-socket)
(deny network-outbound (remote ip "localhost:*"))` — the server and any local service out of reach,
as under MXC. Under `allowedHosts`: only `(allow network-outbound (remote ip "localhost:<port>"))`, and
pi-outpost sets `HTTPS_PROXY`, `HTTP_PROXY`, `ALL_PROXY` (and lower case) in the command's environment
to the proxy's URL, as MXC does. The proxy listens on `127.0.0.1`; Seatbelt's `localhost` matches it
(measured).

**Self-check:** `sandbox-exec -f <profile> /usr/bin/true` with the open-network profile; its stderr is
the reason. Refused off macOS.

**Terminal:** the macOS terminal behaviour of `mxc-macos-seatbelt` applies — the shell is
`sandbox-exec`'s exec, so the pty's own pid *is* the shell after exec: `getCwd` reads it directly when
it has no child, the child otherwise (`firstChildOnMac` falls back to the pid).

## Risks / Trade-offs

- [`sandbox-exec` is deprecated; a future macOS may remove it] → the self-check fails with the reason
  and the runner is refused, never bypassed; MXC stays available on Apple silicon.
- [The profile drifts from what MXC generates] → the real tests are shared in spirit with
  `mxc-macos-seatbelt`'s (same checks), and the profile's source is MXC's printed one, kept in the
  change's proposal.
- [SBPL quoting] → paths come from the configuration; a test feeds quotes and backslashes through it.
- [`sandbox-exec` passes its environment] → pi-outpost already spawns runners with the minimal one.
