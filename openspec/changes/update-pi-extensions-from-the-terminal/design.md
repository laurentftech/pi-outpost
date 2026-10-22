## Context

Settings already lists npm pi packages through the SDK's `DefaultPackageManager`, looks up their newest
versions through pi-outpost's own registry lookup (`server/src/piPackages.ts`), and installs one with
`update(source)` followed by a check of the version on disk (`handleUpdatePiPackage` in `index.ts`).

## Decisions

### The flags are pi's

`--extensions` updates the packages alone and `--all` updates pi-outpost and then the packages, as
`pi update --extensions` and `pi update --all` do. A second convention for the same thing, one
command over, would be one more thing to get wrong.

### One install-and-verify step, shared

The package manager returns without a word when it decides to install nothing — pi's offline mode, or
its own failed look at the registry. Settings learned to believe only the version on disk; the command
must not learn it again. The step moves to `piPackages.ts` as `installNewerPiPackage` and both call it.

### Which packages

A terminal has no open project. The command takes the agent directory's packages, which every project
loads, and the project packages of the directory it runs in (`--cwd`, else the launch directory). Other
projects' packages are updated from Settings in that project.

### No busy-session check

Settings refuses an update while a session that loads the package runs a turn. The command cannot see the
server's sessions. A running server keeps the code it loaded until it restarts (see
`notify-updates-in-the-interface`), so installing underneath it does not change a running turn; the
command says that the new versions run after a restart, and the server, on its next listing, marks the
package as needing one — already specified for an update made "from a terminal".

### Independent of pi-outpost's installation channel

The packages live under the agent directory and are installed by npm there, whatever installed
pi-outpost. So `--extensions` runs for a checkout, an npx run or a standalone executable alike, and
`--all` still updates the packages when pi-outpost itself is refused — exiting non-zero, since part of
what was asked was not done.

### The hint after a plain update

Silent when it has nothing to say: no package, nothing newer, a failed lookup, checking off. It is a
nicety on a command that was asked something else, and a failure about it would be noise.
