# Proposal: the sandbox doctor shows confinement leaks, not only refusals

## Why

Issues #582 and #585 were the same leak twice: on Windows with MXC, the canary reached beside-root — the
bait lives in the host's temporary directory, which on those hosts sat on a **foreign drive** from the
root (`C:` tmp vs `D:` root), first at enumeration level 0, then again at level 2. The canary detected
both (`mxc does not confine: beside-root reached by the canary`), but `pi-outpost sandbox doctor` could
not explain them: its decision log records only *refusals*, so a leak leaves no trace there (in #582 the
log read `last 0` right next to the failure), the verdict itself was never surfaced, PATH probes reported
plain `ok` without saying whether the resolved path was a granted one, and the link table called every
target merely `readable`. Note that a tool path beside the root being readable is *by design* (issue
#562, spec requirement `AToolBesideTheRootResolves`), so a flag that cries leak on every outside-root path
would be noise — the flags must compare against the runtime policy's granted paths. Diagnosing the
confinement failure took hand-patching; the doctor should name the leak itself.

## What Changes

- **Confinement verdict section**: the snapshot (CLI `pi-outpost sandbox doctor [--json]` and the bounded
  agent `sandbox_doctor` tool) SHALL include the agent shell's canary verdict as the interface shows it
  (state, and for a leak the `reached` attempts named in words, e.g. "read a file beside the root"),
  obtained through the same `shellVerdict()` path `pi-outpost doctor` uses — so a leak is visible in the
  doctor instead of only in a startup log line.
- **PATH probes classify against granted paths**: a tool resolved by name outside the sandbox root SHALL
  stay `ok` when the runtime policy grants that path (a tool beside the root, #562); only a resolution
  outside the root **and not granted** SHALL be `fail` with layer `policy`, naming the path.
- **Link table flags ungranted outside-root targets**: each link whose resolved target lies outside the
  root and is not a granted path SHALL be marked as a leak indicator (e.g. `OUTSIDE THE ROOT, NOT
  GRANTED`); granted tool links render without the flag.
- **Probe details are single-line**: newlines and control characters in captured probe output SHALL be
  collapsed before rendering (today a PowerShell error containing a newline truncates the relay URL
  mid-string in the pasted report).
- **Host CLI probe — replays the beside-root canary at the proven level**: the confined probe battery
  SHALL write a marker in a fresh directory under the host tmpdir (the canary's own bait location) and
  attempt a confined read of it at the host's proven MXC enumeration level, reported `ok` when refused
  and `fail` when reached — so "does beside-root leak right now, at the level this host runs at?" is a
  one-line answer in the report.

No change to what the sandbox *allows*: this is diagnosis only — read-only, paste-safe (no environment
values, no credentials, no file contents), and the agent tool stays bounded and never runs probes.

## Capabilities

### New Capabilities
- (none)

### Modified Capabilities
- `sandbox-runner-bash`: the sandbox doctor's snapshot and probe battery gain confinement-leak evidence —
  the canary verdict, outside-root flags on PATH resolutions and link targets, single-line probe details,
  and a beside-root probe at the proven enumeration level.

## Impact

- `server/src/sandboxDoctor.ts`: new `confinement` section in `SandboxSnapshot` (from
  `settledShellVerdict` in `confinementStatus.ts`), outside-root classification in the PATH probes
  (`runDoctorProbes`) and the link table (`linkTableFor`), newline sanitizing of probe details, the new
  beside-root probe; rendering in `renderSnapshot` / `boundedAgentSummary`.
- `server/src/confinementStatus.ts`: expose the attempt words (`ATTEMPT_WORDS`) for rendering, if not
  already exported.
- Tests: `server/test/sandboxDoctor.test.ts` (paste-safety fixture still passes; new scenarios for a
  leaking verdict, an outside-root PATH resolution, an outside-root link target, single-line probe
  details, the beside-root probe).
- Docs: `docs/sandboxing.md` and `docs/command-line.md` sections for `sandbox doctor` gain the new
  sections.
