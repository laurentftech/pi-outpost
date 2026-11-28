# Proposal: one Windows MXC policy — a whitelist, the way down enumerable, no deny list

## Why

Under MXC on Windows, the agent's shell and the confined terminal read their drive whole and deny by name
everything beside the way to what they open. That deny list is what breaks on managed machines:

- Windows builds the process security environment from every policy path and refuses the whole launch
  (`CreateProcessSecurityEnvironment failed (HRESULT = 0x80070005)`) past a size budget (measured: 556
  denied entries pass, 557 refuse) or over one denied path the account cannot open there.
- Each fix stacked a fallback on it: enumeration levels (0 → 1 → 2), then a strict mode that prunes and caps
  the deny list (#590, #592). On a domain-joined machine with the root on `L:` and the profile on `C:`, the
  real policy carries 1,316 denied entries and is refused; the strict policy launches, but only because what
  it cannot deny is left open.
- With the root on another drive than the tools, the way down to them on `C:` is made readable (#572) —
  `C:\Users`, the profile, `AppData`, `AppData\Local` — and readable is recursive: once the deny list is cut,
  all of `AppData\Local`, the temporary directory included, is open (measured: the probe's marker beside the
  sandbox's temporary directory was read).

Issue #593 asked for a pure whitelist. `npm run sandbox:mxc-whitelist` (#594) measured it on two hosts — a
home machine with everything on `C:`, and the domain-joined target above:

| policy on the target | launches | npm, `node <file>` | git, rtk, python, `.ps1` | file beside temp |
|---|---|---|---|---|
| today's (`real`) | refused (1,316 denied) | — | — | — |
| strict (#592) | yes | ok | ok | refused |
| whitelist, drive not readable | yes | `EPERM: lstat 'L:\'` | ok | **read** (way down readable) |
| whitelist, drive roots enumerable | yes | ok | ok | **read** (way down readable) |
| **whitelist, drive roots and way down enumerable** | **yes** | **ok** | **ok** | **refused** |
| whitelist, nothing enumerable | yes | `node` not found | ok | **read** |

Git needs no drive and no relay; Node needs its drive root listable (its `realpathSync` lstats it); nothing
needs a folder above the tools readable once it is enumerable.

## What changes

On Windows under MXC, one policy replaces the drive-plus-deny-list policy, its foreign-drive variant and
the strict mode:

- **Readable or writable**: only what is opened — the root, the temporary directory, the shell's folder,
  the search path's tools and their installations, a junction's target, the grants. No drive root.
- **Enumerable** (names only, no contents): the root of every drive holding one of those, and every folder
  above each of them.
- **Denied**: the agent directory and the configuration file only — no sibling or beside-the-way entries.
- A host whose MXC cannot enumerate (level 2) gets **no shell**, unavailable with the reason, instead of a
  policy where nothing resolves. Level 1 (the grants' ancestors not enumerated) stays: the same
  confinement with fewer listed folders.
- The strict mode (`strictDenies`, `noteMxcStrictDenies`, `STRICT_DENY_BUDGET`) and the readable foreign way
  down are removed.

The cost, stated in the documentation: on every drive holding something the shell opens, the agent can list
file **names** (not read contents), because MXC's enumeration is recursive. microsoft/mxc#1461 asks for a
non-recursive grant; when it ships, the drive roots stop being enumerated.

## Capabilities

### Modified Capabilities

- `sandbox-runner-bash`: the Windows MXC policy is a whitelist with the way down enumerable and no deny
  list beyond the agent directory and the configuration; a host without enumeration has no shell; the
  strict deny list and the readable foreign way down are gone.
- `terminal`: the confined terminal under MXC uses the same policy.

## Impact

`server/src/terminalSandbox.ts` (`mxcTerminalConfig`, strict-mode flag and helpers, `siblings` and
`besideEnumerated` inputs for MXC), the retry loops in `server/src/confinedBash.ts` and
`server/src/confinementStatus.ts`, `server/src/sandboxDoctor.ts` (deny-list evidence), their tests,
`docs/sandboxing.md`. Linux and macOS policies, landstrip and the network rules are unchanged.

Supersedes the unarchived changes `windows-strict-denies-on-security-environment-refusal`,
`windows-foreign-drive-denied-at-every-level` and `windows-foreign-drive-beside-denied`: they are archived
first, and this change removes their requirements.
