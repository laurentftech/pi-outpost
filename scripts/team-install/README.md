# Team install

One command that installs pi-outpost for someone who would otherwise only run
`npm install -g pi-outpost`, together with the
[`@gotgenes/pi-permission-system`](https://www.npmjs.com/package/@gotgenes/pi-permission-system)
extension and a permission policy you choose — and, if asked,
[OpenLore](https://www.npmjs.com/package/openlore)'s structural code tools.

```
# Windows
powershell -ExecutionPolicy Bypass -File install.ps1
powershell -ExecutionPolicy Bypass -File install.ps1 -WithOpenLore

# macOS / Linux
sh install.sh
sh install.sh --with-openlore
```

Hand over this folder with your own `permission-policy.json` in it. The one here is the
extension's own quick-start example, not a recommendation.

## What it does

1. `npm install -g pi-outpost`.
2. Installs the extension with pi's own installer, fetched by `npx` — no global `pi`
   needed. The package is recorded in `~/.pi/agent/settings.json`, and pi-outpost loads
   it on start: `~/.pi/agent` is the agent directory pi-outpost uses unless
   `PI_OUTPOST_AGENT_DIR` or `agentDir` says otherwise.
3. Copies the policy to `~/.pi/agent/extensions/pi-permission-system/config.json`, the
   extension's global configuration.
4. With `--with-openlore` / `-WithOpenLore`, installs OpenLore the same way as step 2.

Set `PI_OUTPOST_AGENT_DIR` before running the script if pi-outpost is configured with
another agent directory; the script installs into the same one.

## Things to know

- **npm must work on the machine.** Both the pi-outpost install and the extension install
  go through it, including a corporate registry set in `.npmrc`.
- **npm 12 blocks install scripts by default.** `tree-sitter-bash` asks to compile a native
  binding and is skipped with a warning; the extension still loads. If bash commands stop
  being recognised by the policy, that is the place to look.
- **Running the script again is safe**: each step can be repeated, and the policy file is
  overwritten with the one next to the script — which is how a policy change reaches
  everyone. The extensions themselves are updated from pi-outpost's Settings, which says when
  a newer version is published, installs it, and restarts pi-outpost to load it.
- **The extension decides** what `ask`, `allow` and `deny` mean — see its
  [configuration reference](https://github.com/gotgenes/pi-packages/tree/main/packages/pi-permission-system).
  pi-outpost shows its questions as it shows any extension dialog. It stacks with
  pi-outpost's own `sandbox` (roots, write, bash): an action has to pass both.

## OpenLore

OpenLore is a pi package: its extension gives the agent native structural tools — who calls
this, what breaks if it changes, which tests cover it — with no MCP server to configure. Each
project open in pi-outpost gets its own OpenLore daemon, started by the extension for that
project's directory and reused by every session on it; the daemon keeps its index fresh with a
file watcher and stops itself after 15 minutes without use.

- **Each project is set up once**, from pi-outpost: type `/openlore` in the composer to open
  OpenLore's configuration wizard, which writes `.openlore/config.json` and offers to run the
  first analysis. A project without it gets no structural tools.
- **It is heavy.** npm installs OpenLore's optional dependencies — the vector search and local
  embedding runtimes — which come to about a gigabyte.
- **Intel Macs.** LanceDB no longer publishes a build for x86_64 macOS, so every tool that
  searches the index — `orient` first among them — fails there with "Cannot find native
  binding". Pinning the last release that had one, inside the installed package, brings
  them back on keyword search:
  `npm i @lancedb/lancedb@0.22.4-beta.3 --no-save --legacy-peer-deps`, run in
  `~/.pi/agent/npm/node_modules/openlore`. An OpenLore update undoes it.
- **Updating** is done from pi-outpost's Settings, as for any pi package — or with pi's
  updater, `npx -y @earendil-works/pi-coding-agent update npm:openlore`, then a restart.

