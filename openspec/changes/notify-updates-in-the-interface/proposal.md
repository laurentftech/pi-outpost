## Why

People who only ever run `npm install -g pi-outpost` never learn that a newer pi-outpost or a
newer extension exists: the one notice there is prints in the terminal at startup, and pi packages
such as `@gotgenes/pi-permission-system` or `openlore` have none at all inside pi-outpost. Keeping a
team current then means walking to each desk.

## What Changes

- **pi-outpost says when it is behind, in the interface.** When a newer pi-outpost is published, the
  standalone app shows a notice naming the running and the new version and inviting the user to run
  `pi-outpost update`, with a copy control for the command. It can be dismissed per version. It never
  installs anything: moving the running server stays the terminal command's job.
- **Extensions installed as pi packages can be updated in one click.** Settings lists the npm pi
  packages the agent loads, with their installed version and, when one is published, the newer one.
  Updating one installs it, then rebuilds the idle sessions that load it — the rules that already
  govern updating an extension repository: an explicit confirmation that code is changing, refusal
  while an affected agent is running a turn, `extensionLock` forbidding it, and a reload failure said
  as such.
- **A check that fails says so.** A package whose newest version could not be looked up — the
  registry unreachable, npm not runnable — is shown as "could not check" with the reason, never as up
  to date.
- **The same switches as today.** `updateCheck: false` and `offline` stop both checks; a checkout of
  this repository gets no pi-outpost notice.

Out of scope: updating pi-outpost from the interface; git-sourced pi packages (pi-outpost's own
repository update already covers repositories enrolled through Settings); pinned package versions,
which are not offered an update.

## Capabilities

### New Capabilities
- `pi-package-updates`: listing the npm pi packages the agent loads with their versions, telling
  when a newer one is published or could not be checked, and updating one from Settings.

### Modified Capabilities
- `update`: the interface notice for a newer pi-outpost.

## Impact

- `server/src/update.ts`: the registry lookup takes a package name instead of assuming pi-outpost;
  the startup check keeps its answer for the interface.
- A new server module for pi packages: reading the agent directory's configured packages and their
  installed versions, checking them, and updating one through the SDK's package manager.
- `server/src/index.ts`: the snapshot carries the pi-outpost notice and the package list; update
  requests reuse the affected-runtime reload.
- `shared/src/protocol.ts`, `ui/src/useAgent.ts`, the Settings menu and the header.
- Docs: README (updating), `scripts/team-install/README.md`.
