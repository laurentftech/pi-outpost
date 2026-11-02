# Proposal

## Why

Settings lists the npm pi packages the agent loads and updates them, but adding or dropping one still
needs a terminal (`pi install npm:…` / `pi remove npm:…`). The people this matters most for — a
Windows office box without a usable terminal, a widget user who never sees the server — cannot change
their agent's extensions at all. The update path already solved the hard parts (registry from
`.npmrc`, npm spawnable on Windows, refusal while a turn runs, "takes effect on a restart"); install
and removal are the two operations missing next to it.

## What Changes

- Settings → Extensions → Packages gains **Add a package**: a field taking an npm name (`openlore`,
  `@scope/name`, or `name@1.2.3` to pin), and a choice between the agent's settings (all projects, the
  default) and the current project's. The name is looked up on the registry the installation uses
  before anything is installed; a name that is not found, or already configured, is refused in place
  without closing the field or losing what was typed.
- Installing requires an explicit confirmation naming the package, the version and the scope, saying
  that code running with the agent's privileges is added and that it takes effect on a restart.
- Each package row gains **Remove**, confirmed in place, naming the scope it is removed from. A
  removed package stays listed, struck through, as *removed — still running until pi-outpost
  restarts*, with **Undo** to reinstall it before that restart. Adding the same name again while it
  is in that state points at Undo instead of producing a second row.
- The restart notice holds one entry per package, reflecting its latest pending change; an Undo that
  restores what is running clears its entry.
- With no package configured, the section shows *No packages installed* and the Add action instead of
  disappearing.
- Install and remove follow the update's rules: refused under `extensionLock`, refused while a
  session that loads the package (all sessions for the agent scope, the project's for the project
  scope) is running a turn or replacing its session, one change per package at a time, and nothing is
  claimed to be running before a restart.
- Layout rules from the review of the mockup: one type size in the section, buttons that never change
  their label (progress and results go in the row's status line), and fixed action slots so nothing
  moves when an action appears, runs or ends.

Out of scope: searching the registry by keyword; git and local sources (already covered by the Agent
resources dialog); the terminal update command (`pi-outpost update --extensions`) is unchanged.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `pi-package-updates`: from "see and update" to "see, install, update and remove" npm pi packages
  from Settings — new requirements for adding a package, removing one, the removed-until-restart
  state with Undo, and the empty list; the listing requirement changes so an empty list is shown,
  and the restart requirement so a removal counts as a change waiting on a restart.

## Impact

- `shared/src/protocol.ts`: new client messages (`install_pi_package`, `remove_pi_package`,
  `restore_pi_package`) with their result messages; `PiPackageInfo` gains a `removed` marker.
- `server/src/piPackages.ts`: version lookup before install, install and remove through the SDK's
  `DefaultPackageManager.installAndPersist` / `removeAndPersist` (`local` for the project scope),
  checked against what is on disk afterwards, as the update is.
- `server/src/index.ts`: handlers with the update's guards; the loaded-at-startup record extended so a
  removed package is still listed until a restart, and restart reasons recomputed rather than only
  added.
- `ui/src/components/PiPackages.tsx`, `SettingsMenu.tsx`, `useAgent.ts`: the add form, remove and undo
  actions, empty state, layout rules.
- Docs: `docs/features.md` (Settings / extensions section).
- No new dependency. The executable-code risk is the same as `pi install`'s, and is stated before
  every install.
