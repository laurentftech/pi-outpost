## Context

See proposal.md for the motivation. What is already there:

- `server/src/update.ts` looks up the newest pi-outpost with `npm view` against the registry the
  installation uses (`.npmrc` included — a corporate registry), falls back to the registry over
  HTTP when npm cannot be spawned, runs `npm` through `cmd.exe` on Windows, and reports a failure
  as a failure. The startup check caches its answer in the agent directory and prints a notice in
  the terminal only. The package name is written into it.
- The SDK's `DefaultPackageManager` lists configured pi packages (`listConfiguredPackages`: source,
  scope, installed path) and updates one (`update(source)`), spawning npm through `cross-spawn`.
  Its own `checkForAvailableUpdates` swallows every error and answers "no update" — on a machine
  where npm cannot be spawned (a Windows box whose server PATH lacks it, seen at the office) it
  would say everything is current.
- Updating an enrolled extension repository already has rules this change reuses: executable-code
  confirmation, `extensionLock`, refusal while an affected runtime is busy, reload of idle
  runtimes, and a reload failure reported as such (`agent-resource-management`).

## Goals / Non-Goals

**Goals:** one check per package that is loud when it fails; updating a package through the same
path pi itself uses; nothing new about how a running agent is protected during an update.

**Non-Goals:** updating pi-outpost from the interface; git-sourced pi packages; a scheduler beyond
"after startup, and when asked"; loading an updated extension without a restart.

## Decisions

### One registry lookup, named by package

`fetchLatestVersion` takes the package name (default `pi-outpost`), and so does its HTTP fallback.
Package checks go through it, not through the SDK's `checkForAvailableUpdates`: the lookup that
already knows the office registry and the Windows spawn rules is the one to trust, and it is the
one that says when it could not check.

### The SDK's package manager lists and installs

A `DefaultPackageManager` over the agent directory (and, for project-scoped packages, the
workspace's directory) lists what is configured and where it is installed; the installed version
is read from that directory's `package.json`. A source with a version (`npm:name@1.2.3`) is pinned
and offered no update. Installing is `update(source)` — the same code `pi update` runs, so a
package lands where the resource loader looks for it.

### Checked after startup, cached, and on demand

The package check starts once the server is up, is not awaited, and keeps each answer in memory
for the same interval as the pi-outpost check — a restart asks again, which is cheap; a failed
answer is not kept. A user's "check now" bypasses it. Results travel in the snapshot and as a server-wide message when they change.

### An update installs; a restart loads it

A running server cannot load an extension's new code: the SDK's loader imports an
extension through jiti, and a second import of the same path returns the module already
evaluated — verified with the SDK's own jiti, with and without `tryNative`, and through
`AgentSession.reload()` (pi's `/reload`). So an update installs through `update(source)`,
checks that the installed version actually changed (the package manager returns silently
when it declines, e.g. in pi's offline mode), and says "installed — restart to use it".

The server records each package's installed version when it starts. A package whose
installed version differs from that record needs a restart — which also catches a
`pi update` run in a terminal.

The same limit very likely applies to updating an enrolled extension repository, which
today reports "reloaded"; that is recorded as a follow-up, not changed here.

### Restarting re-runs the same command under the same parent

The server cannot replace its own process image, so a restart spawns the same command —
`process.execPath` with `process.execArgv` and `process.argv` (the argument list of a
standalone executable), the same environment and inherited stdio — and the old process
stays as a thin parent: it closes its listener and workspaces first, forwards
`SIGINT`/`SIGTERM` to the child, and exits with the child's code. The terminal keeps one
foreground job, Ctrl-C still stops it, and nothing is replaced on disk, so the Windows
file-lock problem of self-update does not arise. Each restart keeps one idle parent; it is
a rare act.

A restart is refused while any agent runs a turn. It is refused on a connection from an
embedded widget — one whose `Origin` is a configured host page rather than the server's own
address or a local development origin — so a page embedding the widget cannot stop the
server. The client reconnects on its own, as it does after any dropped connection.

### The pi-outpost notice is kept, not re-fetched

The startup check keeps its answer in memory, with the channel's instruction (`pi-outpost update`,
or the releases page for an executable). The snapshot carries it when newer; the standalone header
shows it as a dismissible notice with a copy control. Dismissal is per viewer and per version, in
browser storage — a convenience, not state anyone else needs.

## Risks / Trade-offs

- [npm not spawnable at install time] → the check falls back to HTTP, but installing needs npm:
  the update then fails with npm's reason, and the installed version stays. Said, not hidden.
- [Updating replaces code the agent runs] → explicit confirmation naming the versions, and
  `extensionLock` for deployments that must forbid it.
- [A package loaded by a busy session] → refused, naming it; the user retries after the turn.
