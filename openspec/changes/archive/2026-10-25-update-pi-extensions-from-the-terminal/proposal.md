## Why

pi packages — extensions such as a permission system or OpenLore — can be updated from Settings, one
at a time, and only while the interface is open. An operator who updates pi-outpost from a terminal
with `pi-outpost update` has no way to bring its extensions along in the same step, and someone
running the standalone executable, which `pi-outpost update` refuses to replace, has no terminal
path to them at all. pi itself has this as `pi update --extensions` and `pi update --all`.

## What Changes

- **`pi-outpost update --extensions`** looks up and installs the newest version of every npm pi package
  the agent loads — the agent directory's and the current project's — with the same rules as Settings:
  pinned packages are left alone, a failed lookup is never "up to date", `extensionLock` refuses, and
  an install is believed only when the version on disk changed. It works whatever way pi-outpost itself
  was installed.
- **`pi-outpost update --all`** does both: pi-outpost, then its extensions.
- **`--check`** combines with either and installs nothing.
- **Plain `pi-outpost update`** keeps its behaviour and, after its own verdict, names the extensions that
  have a newer version and the command that updates them.
- The command uses the agent directory the server uses: `agentDir` from the configuration, `--agent-dir`,
  or `PI_OUTPOST_AGENT_DIR` — not always `~/.pi/agent`.

Out of scope: git and local pi packages (Settings does not update them either), and detecting a running
server — the command says the new versions take effect when pi-outpost restarts.

## Capabilities

### Modified Capabilities

- `pi-package-updates`: pi packages can also be updated from the terminal.

## Impact

- `server/src/cli.ts` (flags, help), `server/src/index.ts` (the `update` branch, Settings' update handler),
  `server/src/piPackages.ts` (one install-and-verify step shared by Settings and the command).
- `README.md`, `scripts/team-install/README.md`.
