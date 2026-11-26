# Design

## Context

The sandbox doctor (`server/src/sandboxDoctor.ts`) already renders identity, policy by class (including
the runtime policy at the proven MXC enumeration level), the link table, env-filter names, relays,
probes and the refusal-only decision log. Facts that shape this change (see proposal.md - Why, issues
#582/#585):

- A confinement **leak** leaves no trace in the decision log (it records refusals only), and the canary
  verdict — already computed in-process by `confinementStatus.ts` (`settledShellVerdict` /
  `sharedShellVerdict`, type `ConfinementVerdict` in `shared/src/protocol.ts`) — is never surfaced by the
  doctor. `ATTEMPT_WORDS` there maps attempt keys to words ("read a file beside the root") but is
  module-private; the verdict's `reached` carries attempt keys only, never the concrete path.
- The canary's beside-root bait is a `mkdtemp` under the host `tmpdir()` (`confinementCanary.ts`), which
  on the #582/#585 hosts was on a **foreign drive** from the root — the leak fixed by #583/#586. Same-drive
  siblings of the root (`siblingsToDeny`) were denied by name at every level even before; probing one of
  them would answer "refused" on a leaking host. The probe must replay the canary's actual bait.
- A tool path beside the root being readable is by design (issue #562; main-spec requirement
  `AToolBesideTheRootResolves`; `mxcTerminalConfig` drops allowed paths from `deniedPaths`). So
  "outside the root" alone is not a leak signal: the predicate must also check the runtime policy's
  granted paths.
- `pi-outpost sandbox doctor` runs as a **one-shot process before the server starts** (`index.ts`, the
  `cli.command === "sandbox"` branch), so its in-process verdict map is empty; the agent's
  `sandbox_doctor` tool runs inside the server process, where the verdict is already settled.

## Goals / Non-Goals

**Goals:**
- Surface the canary verdict (state + reached attempts in words, single-line capped reason) in both surfaces.
- Classify PATH resolutions and link targets against the runtime policy's granted paths; flag only
  outside-root **and ungranted** ones as leak indicators.
- Render probe details as single lines.
- Replay the beside-root canary (tmpdir bait, confined read) at the proven enumeration level.

**Non-Goals:**
- No change to what the sandbox allows or denies — diagnosis only, no "fix" mode.
- No environment values, credentials or file contents anywhere (paste-safety contract unchanged,
  `assertPasteSafe` fixture must stay green).
- The agent tool stays bounded and never runs probes; only the host CLI does.
- No protocol change: `ConfinementVerdict` already exists in `shared/src/protocol.ts` and is reused
  as-is; `--json` output gains fields additively only.

## Decisions

1. **Where the verdict comes from, per surface.** Both surfaces go through `shellVerdict(sandbox,
   neverReadable)` (`confinementStatus.ts`) — the same path `pi-outpost doctor` uses, which handles
   auto runners (`autoShown`), unavailable runners and the unconfined nudge. The one-shot CLI awaits it
   (the canary is already bounded by `CANARY_TIMEOUT_MS` = 60s); the agent tool reads
   `settledShellVerdict(...)` and reports `checking` when none is settled rather than blocking. The
   verdict reaches `collectSandboxSnapshot` through a new optional `DoctorInput.confinement` field —
   no hidden in-module await, so the collector stays a pure function of its input (testable off-Windows).
   *Alternative:* persist verdicts to disk and read them in the CLI — rejected: a second store that can
   drift from the live verdict.
2. **The granted predicate.** "Leak indicator" = outside the sandbox root AND not covered by the runtime
   policy's granted paths — `readwritePaths ∪ readonlyPaths ∪ enumeratePaths` of the *runtime* policy
   request the doctor already builds (`policyRequestFor(..., mxcEnumerateLevel())`). The policy's own
   tmp (from that request) counts as granted, not `os.tmpdir()` raw. `path.win32.relative` handles
   cross-drive (returns an absolute path) and case is lowercased; trailing slashes normalized.
   *Alternative:* comparing against `windowsToolchains.readable` alone — rejected: it misses the search
   path's granted tool entries and flags healthy granted tools (noise), while reading "granted" as all of
   `readonlyPaths` would flag nothing at all.
3. **The beside-root probe replays the canary's bait.** `runDoctorProbes` already runs through
   `agentBashOptions(...)` → `confinedBashOperations`, whose policy is built at `mxcEnumerateLevel()` —
   so one confined read of a marker in a fresh `mkdtemp(tmpdir())` executes at exactly the proven level.
   `ok` when the read is refused, `fail (policy)` naming the bait path when it succeeds. Skipped with the
   reason when no runner, no proven level (non-MXC), or tmpdir inside the root (the canary's own
   not-checked case).
4. **Single-line details.** A small `oneLine()` (collapse `[\r\n\t]` + control chars to one space) applied
   when capturing probe output and when rendering decisions and verdict reasons; the length cap applies
   after sanitizing so it cannot split a URL across lines.
5. **Verdict rendering reuses attempt words.** Export `ATTEMPT_WORDS` (or a `describeAttempt()`) from
   `confinementStatus.ts` instead of duplicating the mapping in the doctor.

## Risks / Trade-offs

- [CLI doctor blocks up to ~60s awaiting the canary] → the verdict is awaited only via `shellVerdict`,
  which already short-circuits no-bash/unavailable/unconfined without a canary run.
- [The probe writes a marker in the host tmpdir] → host-side write, cleaned up in a `finally`, exactly
  like the canary's own bait; never inside the root (skipped in that case). Read-only from the confined
  side.
- [`failed` verdicts embed a tail of canary output in `reason`] → rendered single-line and length-capped
  (decision 4); paste-safety test extended to cover it.
- [The 4000-char `boundedAgentSummary` cap truncates mid-line] → the confinement section is placed early
  in the bounded summary (before the cap can slice it out), and the cap applies after sanitizing.
- [Probe tests hardcode `process.platform` today] → the classifier (`outsideRoot`/granted check) is a
  pure function tested directly on Linux CI; only the live confined probe is Windows/MXC-only, with a
  smoke task on a real Windows runner.

## Migration Plan

None. Additive output only: new `confinement` section and `LinkEntry.outsideRoot`/`granted` in `--json`,
new lines in text mode. No config, no storage format, no rollback needed beyond reverting the commit.

## Open Questions

- Whether the agent tool should ever *trigger* a fresh canary when no verdict is settled yet (today:
  report `checking`). Deferrable — does not change any scenario in the delta spec.
