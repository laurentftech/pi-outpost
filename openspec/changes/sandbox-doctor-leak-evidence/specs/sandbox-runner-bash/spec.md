# Spec Delta

## ADDED Requirements

### Requirement: TheDoctorNamesTheCanaryVerdict

The sandbox doctor snapshot (CLI and the bounded agent `sandbox_doctor` tool) SHALL include a
confinement-verdict section: the agent shell's canary verdict as the interface shows it — state with
runner and check time, reached attempts in words for a leak, single-line capped reason for a failure.
The CLI SHALL use the same `shellVerdict()` path as `pi-outpost doctor`; the agent tool SHALL report
`checking` when no verdict is settled yet.

#### Scenario: ALeakIsNamedInTheDoctorReport
- **GIVEN** a Windows MXC sandbox whose canary verdict is `leaking` with reached attempt `beside-root` (the verdict records the attempt key; the concrete leaking path — e.g. the foreign-drive tmpdir bait — is what the probe in the last requirement replays; the #582/#585 shape: root `D:\Python\Projet_oper`, host tmp on `C:`)
- **WHEN** `pi-outpost sandbox doctor` runs and the agent calls `sandbox_doctor`
- **THEN** the confinement-verdict section shows state `leaking` and names "read a file beside the root", even when the decision log is empty (`last 0` — a leak is not a refusal), no environment value, credential or file content appears, and in `--json` the section is `confinement: { state, runner, checkedAt, reached?, reason? }`

#### Scenario: AVerifiedShellSaysSo
- **GIVEN** a sandbox whose canary verdict is `verified`
- **WHEN** `pi-outpost sandbox doctor` runs
- **THEN** the confinement-verdict section shows `verified` with the runner and check time

#### Scenario: FailedUnavailableAndUnconfinedVerdictsRenderSafely
- **GIVEN** a verdict of state `failed` (whose reason embeds a tail of canary output), `unavailable`, or `unconfined`
- **WHEN** the snapshot is rendered (text and `--json`)
- **THEN** the section shows the state and a single-line, length-capped reason; no environment value appears (paste-safety fixture still passes)

#### Scenario: TheAgentToolWithNoSettledVerdictYet
- **GIVEN** a confined agent session whose canary verdict has not settled
- **WHEN** the agent calls `sandbox_doctor`
- **THEN** the confinement section reports `checking` rather than guessing or blocking

#### Scenario: ANonMxcBackendDegrades
- **GIVEN** a sandbox on a backend without a canary verdict (seatbelt, wslc, POSIX, no runner)
- **WHEN** the snapshot is collected
- **THEN** the confinement section says so (backend kind / unavailable reason) instead of omitting silently or failing

### Requirement: PATHProbesFlagResolutionsOutsideTheGrantedPaths

A PATH probe whose tool resolves outside the sandbox root SHALL be classified against the runtime
policy's granted paths (read-write ∪ read-only ∪ enumerated, at the host's proven enumeration level):
a granted tool beside the root SHALL stay `ok` (preserving `AToolBesideTheRootResolves`); a resolution
outside the root and not granted SHALL be `fail`, layer `policy`, with a detail naming the path and that
it is not a granted path.

#### Scenario: AGrantedToolBesideTheRootStaysOk
- **GIVEN** an MXC policy granting the search path's tools (a Scoop `current` link under `D:\WRK` with root `D:\pi-outpost`, granted per issue #562)
- **WHEN** the probe battery resolves `npm` to `D:\WRK\Scoop\apps\nodejs\current\bin\npm.ps1`
- **THEN** the probe reports `ok` and is not flagged, because the path is granted by the runtime policy

#### Scenario: AnUngrantedOutsideRootResolutionFails
- **GIVEN** a tool resolving to a path outside the root and outside every granted path of the runtime policy
- **WHEN** the probe battery runs
- **THEN** the probe reports `fail (policy)` with detail "resolves outside the root and is not a granted path: …"

### Requirement: TheLinkTableFlagsUngrantedOutsideRootTargets

Each link/junction entry SHALL carry `outsideRoot` and `granted` (whether its resolved target is covered
by the runtime policy's granted paths); a link whose target is outside the root and not granted SHALL be
rendered as a leak indicator (e.g. `target readable — OUTSIDE THE ROOT, NOT GRANTED`), while a granted
outside-root target renders without the flag.

#### Scenario: AnUngrantedOutsideRootLinkTargetIsFlagged
- **GIVEN** a link whose target lies outside the root and in no granted path, yet is readable
- **WHEN** the snapshot is rendered
- **THEN** the link line carries the outside-root-not-granted flag

#### Scenario: AGrantedToolLinkIsNotFlagged
- **GIVEN** a Scoop `current` link whose target is a granted tool path outside the root (issue #562 behavior)
- **WHEN** the snapshot is rendered
- **THEN** the link line has no leak flag

### Requirement: ProbeDetailsAreSingleLine

Captured probe output and decision-log lines SHALL be collapsed to a single line (newlines, tabs and
control characters become one space) before they enter a probe detail or a rendered line, and any
length cap SHALL be applied after sanitizing. The newline in the #582/#585 pastes came from the captured
PowerShell error output, not the probe URL (already whitespace-stripped before use).

#### Scenario: ARelayProbeFailsWithAMultiLineError
- **GIVEN** a registry-relay probe whose captured PowerShell error contains a newline inside the URL text (the #582/#585 paste showed `http://127.0.0.1:4473hea` cut mid-string)
- **WHEN** the snapshot is rendered (text and `--json` detail fields)
- **THEN** the probe detail is one line with whitespace collapsed and the URL intact

### Requirement: TheHostProbeBatteryReplaysTheBesideRootCanary

The host CLI probe battery SHALL replay the canary's beside-root attempt at the host's proven enumeration
level: a marker in a fresh directory under the host's temporary directory (the canary's own bait
location), then a confined read of it through the same runner the battery uses. `ok` when refused;
`fail`, layer `policy`, naming the bait path, when reached; skipped with the reason when it cannot run.

#### Scenario: BesideRootIsRefusedAtTheProvenLevel
- **GIVEN** an MXC host that proved enumeration level 2 and denies what lies beside the foreign way down at every level (post-#586)
- **WHEN** `pi-outpost sandbox doctor` runs the probe battery
- **THEN** the beside-root probe reports `ok` with a detail naming the level, e.g. "refused at level 2"

#### Scenario: BesideRootIsReachedThroughTheForeignDrive
- **GIVEN** a pre-#586 host where the temporary directory sits on a foreign drive from the root (the #585 shape: root `D:\Python\Projet_oper`, tmp on `C:`) and the beside-root bait is readable
- **WHEN** the probe battery runs at the proven level
- **THEN** the beside-root probe reports `fail (policy)` naming the bait path that was read, alongside the `leaking` verdict section

#### Scenario: TheProbeIsSkippedWhenItCannotRun
- **GIVEN** no confined runner, a backend without a proven enumeration level, or a temporary directory inside the root
- **WHEN** the probe battery runs
- **THEN** the beside-root probe is `skipped` with the reason, and the rest of the battery still runs
