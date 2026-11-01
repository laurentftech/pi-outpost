# Proposal

## Why

Today the sandbox is entirely opt-in. Without a `sandbox` section the agent's file tools reach the whole
disk and its `bash` runs with every right of the server's account. Confining the shell takes a runner
named by hand (`"mxc"`, `"seatbelt"`, landstrip) and, on Windows, a `bashShell`. Most installations
never get there, although pi-outpost already ships MXC and can tell, through the runner's probe and the
confinement canary, whether this machine can confine at all.

The catch is Windows: MXC's process container needs Windows 11 24H2/25H2 with the August 2026 update
(26100/26200.9278), 26H2 26300.9550 or 26H1 28000.2804. Many managed machines are not there yet, so the
default must degrade safely there, and the user must keep a deliberate way to get an unconfined shell back.

## What Changes

- **BREAKING** A configuration without a `sandbox` section gets a default sandbox: rooted at the working
  directory, writing allowed inside it, and a shell whose runner is chosen automatically. `"sandbox": false`
  restores the previous, unsandboxed behaviour.
- New `sandbox.bashRunner` value `"auto"`, the default whenever `bashRunner` is absent. It picks the
  platform's runner (MXC's executor on Windows and Linux, Seatbelt on macOS) and accepts it only once its
  self-check and the confinement canary have both passed. On Windows it also picks PowerShell as the shell
  when `bashShell` is absent.
- An existing `sandbox` section is left as it is: `allowBash` without a `bashRunner` still runs an unconfined
  shell, now read as the legacy spelling of `"none"`. The default applies only where the configuration
  says nothing.
- An unconfined shell gets an open lock instead of no lock. The lock is the nudge to migrate: when this
  machine's runner passes its self-check, the lock is highlighted and its description names that runner
  and the line to add (`"bashRunner": "auto"`). The startup log and `pi-outpost doctor` say the same. When
  the runner fails its self-check (the office case, an older Windows build), the lock is neutral and only
  says why nothing can confine. There is no separate notice and nothing to dismiss.
- New `pi-outpost config --confine`: it checks the runner on this machine (self-check and canary) and, only
  if both pass, writes `"bashRunner": "auto"` into the configuration file. Otherwise it leaves the file
  untouched and prints the reason. The lock's suggestion, the startup log and `doctor` all point to this
  command. There is deliberately no flag or environment variable that loosens confinement: loosening stays
  a decision written into the file.
- Fail-closed: when no runner can confine on this machine (Windows build too old, executor missing, user
  namespaces refused, canary leak), the shell tool stays registered but refuses every command with the
  reason. The interface shows the same reason. Nothing falls back to running unconfined.
- New explicit escape hatch `sandbox.bashRunner: "none"`: the shell runs unconfined, as `allowBash` without
  a runner did before. It can be set in the configuration file only, never from Settings, and the interface
  marks the shell as unconfined.
- Choosing the runner never delays the start of the session. The first command waits for the choice if it
  is still pending.
- Not covered by this change: the terminal panel (`terminal.sandbox` stays opt-in, and so does
  `terminal.enabled`), and `rpc` mode, which refuses any sandbox and therefore gets no default.

## Capabilities

### New Capabilities
- `sandbox-defaults`: the sandbox an installation gets when its configuration does not describe one, the
  automatic choice of a runner for the agent's shell, the fail-closed outcome, the explicit
  unconfined opt-out, and the nudge to confine an unconfined shell where this machine could.

### Modified Capabilities
- `sandbox-runner-bash`: `bashRunner` gains the values `"auto"` and `"none"`. An automatically chosen
  runner that fails the canary refuses commands instead of only showing an open lock.

## Impact

- `server/src/config.ts`: default sandbox, `"auto"`/`"none"` resolution, `"sandbox": false`, and the
  `rpc` exemption.
- `server/src/sandbox.ts`, `server/src/confinedBash.ts`, `server/src/confinementStatus.ts`: a runner chosen
  in the background, shared by the self-check and the canary, plus the refusal reason.
- `server/src/terminalSandbox.ts`: the MXC probe's reason names the Windows build and the update it needs.
- Protocol (`ConfinementVerdict`): an `unconfined` state that may carry the runner that would work, and an
  `unavailable` state carrying the reason.
- UI (`ConfinementLock`): the open lock, highlighted or neutral, plus "choosing" and "unavailable".
- `pi-outpost doctor` and `pi-outpost init`: report and write the new defaults.
- `server/src/cli.ts`: `config --confine`, in the help and the CLI spec's command inventory.
- Docs: `docs/sandboxing.md` (recommended setup, Older Windows, the escape hatch) and `README.md` (the
  "not confined" note and the configuration examples).
