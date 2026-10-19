# A lock that shows confinement was verified, not only configured

## Why

The terminal shows "🔒 confined to <root>" whenever `terminal.sandbox` is set and the runner passed its
self-check — a check that only proves the runner *starts* (`landstrip doctor`, MXC's probe, a confined
`true`). It never proves the limits hold. The agent's own shell shows nothing at all. A user cannot
tell a confined agent from an unconfined one, and a lock earned by configuration alone is exactly the
false sense of security that is worse than none: a policy that, through a bug or a host quirk, lets the
agent directory be read would still wear the lock.

Today's work showed how real that is: the same profile behaved differently across hosts (a `/proc`
mount refused under Docker's masked paths, a login shell undoing the search path), and each was found
only by running the thing.

## What Changes

- **A canary**: one command run through the real runner, with the policy a real command gets, that
  attempts what confinement must refuse and reports each outcome:
  - read a file in the agent directory, and one beside the root;
  - write a file beside the root;
  - signal the server's process;
  - find a key the server holds in its own environment;
  - under `sandbox.allowedHosts`, reach a host not on the list (through the proxy it is given).
  The canary prepares the bait itself (a file beside the root, a marker variable in the server's
  environment) in a private directory, and cleans up.
- **When**: at start once the runner's self-check passed, and again when the sandbox settings change;
  the result is part of the state the server sends.
- **The lock**: the agent's shell gets one, beside the composer's status; the terminal's badge follows
  the same rule.
  - closed (🔒) only when every attempt was refused — its tooltip names the runner, the time of the
    check and what was refused;
  - open and red (🔓) when any attempt got through, naming which — the configuration is *not* changed:
    the user sees the truth and decides;
  - "checking…" while the canary runs; nothing when no runner is configured (the shell is plainly
    unconfined, and the settings already say so).
- **`pi-outpost doctor`** runs the same canary for each configured runner and reports a failed check
  per attempt that got through, so a headless server gets the same answer.
- The agent is not told about the lock; the lock is for the user.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `sandbox-runner-bash`: a verified-confinement check for the agent's shell, its result shown as a lock,
  and in `doctor`.
- `terminal`: the confined badge shows only when the same check passed for the terminal's runner.

## Impact

`server/src/` (a canary beside `checkRunner`, its result in the state snapshot, `doctor.ts`),
`shared/src/protocol.ts` (the verdict), `ui/src/` (the composer's lock, `TerminalPanel`'s badge), tests,
`docs/sandboxing.md` (*Check that it is really confined* becomes this), README.
