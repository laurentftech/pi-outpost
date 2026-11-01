# Design

## Context

- `loadConfig` (`server/src/config.ts`) sets `config.sandbox` only when the file has a `sandbox` section.
  `resolveRunner` turns `"mxc"` into the bundled executor and `"seatbelt"` into `sandbox-exec`. Every
  other value is resolved as a path.
- Each runner already has a self-check, cached per runner path (`confinedBash.ts`). On Windows it is
  `wxc-exec --probe` (`checkMxcRunner` in `terminalSandbox.ts`), which accepts only the `base-container`
  tier, that is, the builds in MXC's process-isolation table. On Linux and macOS it runs one confined `true`.
- The canary (`confinementCanary.ts`, `confinementStatus.ts`) runs after the self-check. Its verdict goes
  to clients as a lock. Today a leak only opens the lock and does not stop commands.
- `rpc` mode refuses any sandbox (`config.ts:1198`).

## Goals / Non-Goals

**Goals:** a default that confines, a safe failure on unsupported Windows builds, an explicit unconfined
escape hatch, and a nudge for capable machines still running unconfined.

**Non-Goals:** confining the terminal by default; changing `allowBash`'s default inside an explicit
section; choosing among several runners per platform (landstrip is never auto-chosen, because it is a
separate install); editing the runner from Settings.

## Decisions

1. **The MXC probe, not the registry, decides whether Windows is supported.** MXC's own documentation says
   runtime probing is authoritative and gives no minimum build, and `--probe` already refuses tiers below
   `base-container`. We read `CurrentBuild` and `UBR` from the registry only to word the refusal ("build
   26100.8xxx; install the August 2026 update, KB5120998, or later"). They never gate anything.
   *Alternative:* a hard-coded build table as the gate. It would go stale with each Windows release and
   could disagree with the executor.
2. **`"auto"` is a lazy, shared resolution.** It is one promise per sandbox configuration: candidate →
   self-check → canary → a chosen runner or a refusal reason. Session start fires it without awaiting it.
   The shell tool's `exec` awaits it, and so does the lock state sent to clients ("choosing", then
   "confined" or "unavailable"). Changing the sandbox settings starts a new resolution, as the canary does
   today.
3. **Candidates:** Windows → bundled `wxc-exec.exe` with PowerShell (`powershell.exe`, found on PATH as
   in `ABareShellIsFoundOnThePath`); Linux → bundled `lxc-exec`; macOS → `"seatbelt"` (every Mac, no
   architecture limit). There is one candidate per platform, so the reason a run is refused is always about
   one runner. *Alternative:* trying MXC, then landstrip on PATH, on Linux. That would make the result
   depend on whatever happens to be on PATH, so we drop it.
4. **The tool name is fixed when the session starts.** On Windows `"auto"` always registers `powershell`,
   because PowerShell is the default shell there. The tool does not change once the choice completes.
5. **`"none"` and the legacy spelling** share one code path, today's unconfined `bash`. The legacy spelling
   exists only so that older files keep working. `"none"` is the spelling the docs and the nudge use.
   Settings carry `bashRunner` over without editing it, as they already do (`SettingsPreserveTheRunner`),
   and a Settings payload that names a runner is refused.
6. **The lock is the nudge.** `ConfinementVerdict` gains
   `{ state: "unconfined"; available?: { runner } | { reason } }` and `{ state: "unavailable"; runner; reason }`.
   For an unconfined shell the server runs only the platform's self-check, not the canary (that is cheaper
   and already enough to say a runner "would work"). It sends the result as `unconfined`, with
   `available.runner` when the check passes. `ConfinementLock` shows an open lock: highlighted, with the
   line to add, when a runner is available, and neutral otherwise. The startup log and `doctor` (as a
   warning, not a failure) carry the same text. *Alternative considered:* a separate dismissible notice
   whose dismissal persists. It meant a second surface and a runtime setting, while the lock is already
   where the user looks for confinement and stays discreet.
7. **`config --confine` edits the file in place, minimally.** The configuration is plain JSON
   (`JSON.parse`, no comments), so the command parses it, inserts or replaces `sandbox.bashRunner` and
   rewrites it with the file's detected indentation and line endings (CRLF on Windows), preserving key
   order. It writes to a temporary file in the same directory and renames it over the original, so an
   interrupted write cannot leave a truncated configuration. Verification uses the same `"auto"`
   resolution as the server (decision 2), awaited synchronously, so the command and the server cannot
   disagree about what passes. *Alternative:* a startup flag `--confine`. It would have to be repeated at
   every launch, and its natural counterpart (`--no-confine`, or an environment variable) would let an
   inherited setting loosen the sandbox, the risk `config.ts` already guards against for the cwd.
8. **`"sandbox": false`** is checked before the default applies. It is the only way to get the old,
   unscoped toolset without writing a section.

9. **The configuration file is out of the agent's reach for writes.** A server-wide set of protected
   files, filled with the configuration's real path at startup, is checked by the one refusal every writing
   tool already goes through (`piConfigWriteRefusal`: `edit`, `write`, and `assertWritableDestination` for
   the document tools). Without it the default — a writable project, often holding `pi-outpost.config.json`
   — would let the agent write `"bashRunner": "none"` for the next start. The confined shell cannot reach
   it either (MXC's policy denies the configuration). *Alternative:* a read-only default — safer, much less
   useful.

## Risks / Trade-offs

- [Existing users without a `sandbox` section lose unscoped writes] → The startup log names the change and
  `"sandbox": false`; it is the release's headline note.
- [The canary takes up to 60 s on a cold MXC] → It runs in the background. Only a command issued in that
  window waits, and the interface says "choosing".
- [The agent sees a `powershell` tool that refuses every command on old Windows] → The refusal names the
  build, the update to install and `"bashRunner": "none"`, so both the agent and the user can act on it.
- [An open lock worries users on machines that cannot confine] → There it is neutral, not red, and its
  description says why. That is the truth, and it is what `"none"` chose.

## Migration Plan

No file is rewritten. Files with a `sandbox` section behave as before, and the nudge invites them to
switch. Files without one get the default. Rolling back means `"sandbox": false`, or downgrading the
package.
