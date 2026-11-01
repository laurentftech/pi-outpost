# Deployment and updates

[Home](../README.md) · [How-to](how-to.md)

- [Staying up to date](#staying-up-to-date)
- [Running it as a service](#running-it-as-a-service)
- [Installing it as an app](#installing-it-as-an-app)

## Staying up to date

The server checks once a day whether a newer version has been published, and says so in one
line if there is — in the terminal, and in the standalone interface as a notice with the
command to copy and a link to the new version's release notes, which can be dismissed for
that version. **It never installs pi-outpost on its own** — `pi-outpost update` is the only
thing that installs it, and only when you run it without `--check`.

After an update, the standalone interface says which version you moved from and, on
**What's changed**, shows the [changelog](../CHANGELOG.md) sections in between. The changelog
ships inside the package and the executables, so this needs no network and works with
update checks turned off. It is shown for as long as the new version runs, until you dismiss
it in that browser; a first install shows nothing, and `changelogNotice: false` turns it off.

**pi packages** — extensions installed with `pi install npm:…`, such as
`@gotgenes/pi-permission-system` or `openlore` — are listed in Settings with the version
installed and, once checked, whether a newer one is published; a check that fails says why.
**Update** installs the newer version after a confirmation naming both versions. A running
server cannot load an extension's new code, so the package then shows *restart to use it*,
and **Restart pi-outpost** stops and starts the server again in the same terminal: every
open window reconnects by itself and conversations are kept. Restarting is refused while an
agent is running a turn, and is never offered in an embedded widget; `extensionLock` forbids
updating. A version changed from a terminal (`pi update`) is marked the same way.

From a terminal, `pi-outpost update --extensions` does the same for every npm pi package at
once — the agent directory's, the one the server uses (`agentDir`, `--agent-dir`), and the
current directory's project — and `pi-outpost update --all` updates pi-outpost first, then
them. It works however pi-outpost was installed, the standalone executable included.
`--check` reports and installs nothing; pinned packages are left as they are; a failed
lookup, an install that installed nothing or an unreadable `settings.json` exits non-zero;
`extensionLock` refuses; git and local packages are named and left to `pi update`. The new
versions run once pi-outpost restarts. A plain `pi-outpost update` ends by naming the
packages that have a newer version.

What `update` does depends on how this copy was installed, which it works out rather than
asking:

| How you run it | What `update` does |
|------|------|
| Global npm install | Prints `npm install -g pi-outpost@latest`, runs it, reports the version it moved to |
| Source checkout | Refuses, and tells you to `git pull` — installing would put a *second* copy elsewhere and leave the one you are running untouched |
| `npx pi-outpost` | Explains that your next `npx` already fetches the newest version |
| Standalone executable | Refuses to overwrite itself, and points at the [releases](https://github.com/laurentftech/pi-outpost/releases) |
| Anything it cannot recognise | Refuses rather than guessing, and prints what it compared: the entry it runs from, npm's global `node_modules` (or that `npm root -g` gave no answer), and the runtime |

A check that fails is never reported as "up to date": `update --check` says it could not
check, and why, and exits non-zero.

| Key | Effect |
|------|------|
| `updateCheck` | `false` disables checking entirely. `true` enables it **even under `offline`**. Unset, `offline` decides |
| `updateRegistry` | Optional registry override, when npm's own configuration does not name the right one |
| `changelogNotice` | `false` hides what an update changed. The running version is still recorded, so turning it back on does not announce a past update |

Version checks normally run through `npm view`, so an existing `.npmrc` remains the source
of truth for an internal registry, authentication, CA certificates and proxies. No duplicate
pi-outpost setting is required for a Nexus setup that already works with npm.

`offline` means "remote model catalogs are unreachable", which is not the same network as a
package registry — a host air-gapped from the former can still reach an internal npm proxy,
and that is exactly the deployment where knowing a release exists matters. So `offline` is a
default for update checking, not a veto.

## Running it as a service

```bash
npm run start
```

Builds the interface once and starts **one** Node process serving the app, `/ws`,
`/branding` and `/health` together on `server.port` — nothing else to run or keep track of.
Point a process manager (systemd, pm2, Docker `CMD`, …) at that one command.

It reads *your* configuration (`./pi-outpost.config.json`, or any of the locations above);
with none, it refuses to start and says so. There is no hot reload here: rebuild
(`npm run build --workspace web`) and restart after a UI change.

To distribute a version that needs no Node.js at all — a Windows `.exe` for non-technical
users, say — see [`docs/sea-packaging.md`](sea-packaging.md).

## Installing it as an app

The standalone interface declares itself to the browser, so it can be installed from the
address bar and opened from the desktop or taskbar: its own window, its own name and icon,
no tabs.

It is the same interface, on the same server, with the same sessions — installation changes
where it runs, never what it is. It also caches nothing of itself: with the server down, an
installed app says it cannot reach it rather than showing a stale copy of a previous build.

A mounted widget claims nothing on its host page: no manifest, no icon, no change to whether
the host page itself is installable.
