# Design

## Context

See proposal.md for why. What exists today:

- `server/src/piPackages.ts` lists npm pi packages through the SDK's `DefaultPackageManager`
  (`listConfiguredPackages`, one manager kept per agent dir + project cwd, settings reloaded before
  each use), checks newer versions with the same `npm view` lookup pi-outpost uses for itself
  (`server/src/update.ts`: `npmViewInvocation`, `.npmrc` honoured, `npm.cmd` spawnable on Windows,
  `condenseNpmError`), and updates one package with `manager.update(source)`, judging success by what
  is on disk afterwards.
- `server/src/index.ts` handles `check_pi_packages` and `update_pi_package`: refused under
  `extensionLock`, for an unknown or pinned source, while the same package is updating
  (`updatingPiPackages`), and while an affected session is busy (`busyResourceConsumer` over every
  started workspace for the `user` scope, the project's sessions for `project`). It then refreshes
  the lists of every affected root.
- Restart tracking: `markRestartNeeded` records, per scope, the version of each package seen in the
  first listing after startup (`loadedPiPackages`), and marks a package whose installed version
  differs. `restartReasons` is a set that only grows.
- The SDK (`@earendil-works/pi-coding-agent` 1.5.0) exposes `installAndPersist(source, { local })` and
  `removeAndPersist(source, { local })`, where `local: true` targets the project's `.pi/settings.json`.
- UI: `ui/src/components/PiPackages.tsx` renders the list inside `SettingsMenu.tsx`'s Extensions
  section, and returns `null` for an empty list. `RestartNeeded.tsx` shows the restart notice.

## Goals / Non-Goals

**Goals:**
- Install and remove go through the same guards, lookup and "judge by what is on disk" rules as the
  update, so the three operations cannot drift apart.
- The removed-until-restart state is derived from the startup record, not from a client-side flag,
  so every client and a reconnecting one see it.

**Non-Goals:**
- No keyword search on the registry (npm search does not go through every proxy, and the user named
  the package anyway).
- No change to `pi-outpost update --extensions`.
- No install from git or local paths here: the Agent resources dialog owns those.

## Decisions

### 1. One server-side "package change" path for install, remove and restore

Install, remove and restore are three client messages (`install_pi_package`,
`remove_pi_package`, `restore_pi_package`) answered by one result type carrying the request id, an
outcome (`installed | removed | restored | failed | refused`) and a message. Their handler shares one
guard function extracted from `handleUpdatePiPackage`: `extensionLock`, one change per package name
(the existing `updatingPiPackages` set, renamed to cover every change), affected sessions computed
from the target scope, `busyResourceConsumer`. The update handler uses it too.

*Alternative*: a generic `change_pi_package { action }` message. Rejected: separate messages keep each
one's payload exact (install needs a name, a version and a scope; remove only a source), and the
protocol's existing style is one message per action.

### 2. Lookup before install, with the update's `npm view`

`install_pi_package` is two-phase at the UI, one message at the server:

- The client first sends `lookup_pi_package { name, version?, scope, requestId }`. The server
  validates the name against npm's package-name rules (a pure function, no spawn for garbage),
  refuses one already configured in that scope or listed as removed (pointing at restore), then runs
  `npm view <name>[@<version>] version --json` through `npmViewInvocation`. An empty answer for a
  versioned spec means that version does not exist. The answer is the resolved version.
- The confirmation then names that version, and `install_pi_package` carries it. The server
  re-checks every guard (the confirmation may have waited) and installs `npm:<name>@<version>` when
  the user typed a version (pinned), `npm:<name>` otherwise.

*Alternative*: let the SDK's `installAndPersist` fail on an unknown name. Rejected: its error arrives
after it may have written the settings entry, the spec requires that nothing be installed by the
lookup, and the confirmation must name a real version.

### 3. Install and remove through the SDK, judged by the disk

`installAndPersist(source, { local: scope === "project" })` and the matching
`removeAndPersist`. Afterwards the package is listed again: an install that left no installed version,
or a removal that left the source configured, is reported as failed with the reason (including
`PI_OFFLINE`, as the update does). On a failed install, if the settings now carry the source, it is
removed from settings again (`removeSourceFromSettings`) so the spec's "settings do not configure it"
holds.

### 4. Removed-until-restart comes from the startup record

`loadedPiPackages` already maps `scope:name → version loaded`. A listing now appends, for each loaded
entry whose source is no longer configured in its scope, a `PiPackageInfo` with `removed: true` and
the loaded version (`installed` absent, since it is uninstalled). Restore reinstalls
`npm:<name>@<loaded version>` only when the removed source was pinned, `npm:<name>` with the loaded
version otherwise (`installAndPersist("npm:<name>@<version>")`, then the settings entry rewritten to
the unpinned source), so the restored state equals what is running.

`restartReasons` becomes computed: after every listing the server recomputes the set from the marked
entries (installed ≠ loaded, configured since, removed) and broadcasts `restart_needed` only when it
changed. This is what lets an undo clear its entry, and keeps one entry per package.

*Alternative*: keep the removed rows in the client. Rejected: another client, or a reload, would show
the package as gone while it still runs.

### 5. UI: one row model, fixed slots, status line carries progress

`PiPackages.tsx` keeps one row per package with two fixed-width action slots (Update | Remove or
Undo); an absent action is an invisible placeholder of the same size, so the name never changes
width. Buttons keep their labels; the pending operation, the outcome or the refusal reason is the
row's status line (`updating to 33.1.0…`, `removed — still running until pi-outpost restarts`). Names
use the section's sans font (no monospace), the project marker is a `this project ·` prefix of the
status line, and every text in the section is `text-xs`. The add form (field, scope radios, Cancel /
Install…) puts its message line below the buttons with a reserved one-line height. The confirmation
is consumed on first click (the server's per-package guard is the real protection). The mockup at
`openspec/changes/install-pi-packages-from-settings/mockup.html` is the reference.

### 6. Scope default and naming

The add form defaults to the agent's settings ("all projects"). The project option names the
project ("this project only (pi-outpost)"), because writing there lands in the repository's
`.pi/settings.json`, which is versioned.

## Risks / Trade-offs

- [Installing runs third-party install scripts and extension code with the server's rights] →
  stated in the confirmation, refused under `extensionLock`, same exposure as `pi install`. npm 12's
  install-script approval may block a native dependency (seen with node-pty): the install then
  "succeeds" with a broken package. → Out of scope here; the result message reports what npm said.
- [The SDK may write the settings entry before the install fails] → Decision 3 removes it again and
  re-lists to verify.
- [Two clients changing the same package] → the per-package guard refuses the second; both clients
  receive the refreshed list.
- [Project scope writes into a git repository] → the option names the project; agent scope is the
  default.
- [Restoring a removed unpinned package may fetch a newer version if the loaded one was unpublished]
  → restore asks for the loaded version explicitly; if it is gone, it fails and says so.

## Migration Plan

Additive protocol messages; an older client never sends them and still sees the list (the `removed`
field is optional). No settings migration. Rollback is reverting the UI and handlers; settings
written by an install are ordinary `pi install` settings.
