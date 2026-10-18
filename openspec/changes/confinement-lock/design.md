# Design

## Context

Runners today: landstrip (Linux, Windows), MXC (`wxc-exec.exe`, `lxc-exec`, `mxc-exec-mac`) and — with
`seatbelt-runner` — `sandbox-exec`. `checkRunner` answers "can it start?" once; its result gates the
terminal (`terminalRunner`) and the agent's shell (`cachedCheck` in `confinedBash.ts`). The snapshot
sends `terminal.confined` when `terminal.sandbox` is set, and `TerminalPanel` draws the badge from it.
`doctor.ts` builds `Check[]` (`ok`/`warn`/`fail`) and `exitCodeFor` turns a failure into exit status 1.

The agent's shell runs a script file in `bashShell` (bash, busybox `sh`, or PowerShell); the terminal
runs an interactive shell. Both get their policy from the same builders.

## Goals / Non-Goals

**Goals:**
- A lock that is only ever closed when the limits were observed holding, through the real runner.
- The same answer in the interface and in `doctor`.
- No false alarm on a correct setup: an attempt that cannot be made meaningfully is "not checked",
  not a leak.

**Non-Goals:**
- Changing behaviour on a leak (refusing the shell, editing the configuration): the user decides.
- Telling the agent; proving the network beyond `allowedHosts` (an open network is the documented
  default).
- Continuous monitoring: once at start and on each sandbox change.

## Decisions

**The canary goes through the real path.** For the agent's shell it is a command run by
`confinedBashOperations` with the workspace's options — same runner, policy builder, environment,
proxy. For the terminal it is the same command run once (non-interactive) under the terminal's policy
(`terminalConfinement`), spawned like the agent's command, not through a pty. Alternative: a dedicated
probe policy — rejected, it would test something else than what runs.

**Bait, prepared by the server, removed after:**
- a marker file in the agent directory (`.pi-outpost-canary-<id>`) — read must fail;
- a private directory outside the root (`mkdtemp` in the system temp) holding a marker file — read must
  fail, and a write into it must fail; skipped as "not checked" if that directory falls inside the root
  or the writable zone (a root of `/` or of the home);
- a marker variable set in the server's own environment for the run (`PI_OUTPOST_CANARY_<id>`) — the
  canary must not see it, in its environment nor (Linux) in `/proc/<server pid>/environ`;
- the server's pid — `kill -0` must fail (POSIX; on Windows, `Stop-Process -WhatIf` is meaningless, so
  `[System.Diagnostics.Process]::GetProcessById(<pid>).Kill()` against a throwaway child the server
  spawns instead, checked alive afterwards);
- under `allowedHosts`, a request to `canary.invalid` through the proxy (refused by the proxy before any
  DNS, offline-safe) and a direct connection to an address outside the list — must fail.

**The canary's output** is one line per attempt, `PI_OUTPOST_CANARY <name> refused|reached`, printed by
a script in the shell's language (POSIX `sh` or PowerShell). A missing line is a failure of the canary
itself ("could not check"), shown as a warning, never as a closed lock.

**Verdict in the snapshot.** `confinement: { bash?: Verdict; terminal?: Verdict }` with
`Verdict = { state: "checking" } | { state: "verified"; runner; checkedAt; refused: string[]; notChecked: string[] }
| { state: "leaking"; runner; checkedAt; reached: string[] } | { state: "failed"; reason }`. Absent when no runner.

**Interface.** The composer's status row gets a lock beside the model selector: 🔒 verified, 🔓 red
leaking, a muted "checking…", a warning sign when the canary failed. Its tooltip lists the attempts.
`TerminalPanel`'s badge reads `confinement.terminal` the same way (today's `confined` stays for "a
runner is configured", e.g. for the startup notice).

**`doctor`.** `confinementCheck` per configured runner (agent's shell, terminal): `ok` verified, `fail`
leaking (one line per reached attempt), `warn` not checked or canary failed. Uses the configuration's
paths; the server need not be running.

**A readable server environment.** landstrip on Linux cannot hide another process of the same user, so
a command reads the server's `/proc/<pid>/environ`. The canary reports that attempt separately from
its own environment (which must never hold the bait), and the server judges it by what its own start
environment holds: variable names matching a key, token, secret, password or credential. None: the
lock stays closed, the tooltip saying the environment is readable but holds no secret. Some: a
`partial` verdict, amber, naming the variables (never their values) and pointing at the agent
directory. A later change may remove the gap itself by re-executing the server without them.

## Risks / Trade-offs

- [A canary that passes while the real use leaks — e.g. the terminal's interactive shell differs] →
  the canary runs each surface's own policy; the real-runner tests keep covering the interactive path.
- [Bait in the agent directory] → a uniquely named file, removed in `finally`; never touching `auth.json`.
- [Start-up time] → the canary runs after the server is listening, off the critical path; the lock says
  "checking…" meanwhile.
- [A root that contains the system temp] → that attempt is "not checked" and the tooltip says why,
  rather than a false leak.
