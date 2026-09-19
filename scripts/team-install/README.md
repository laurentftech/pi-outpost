# Team install

One command that installs pi-outpost for someone who would otherwise only run
`npm install -g pi-outpost`, together with the
[`@gotgenes/pi-permission-system`](https://www.npmjs.com/package/@gotgenes/pi-permission-system)
extension and a permission policy you choose.

```
# Windows
powershell -ExecutionPolicy Bypass -File install.ps1

# macOS / Linux
sh install.sh
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
  everyone. To update the extension itself, use pi's updater:
  `npx -y @earendil-works/pi-coding-agent update npm:@gotgenes/pi-permission-system`.
- **The extension decides** what `ask`, `allow` and `deny` mean — see its
  [configuration reference](https://github.com/gotgenes/pi-packages/tree/main/packages/pi-permission-system).
  pi-outpost shows its questions as it shows any extension dialog. It stacks with
  pi-outpost's own `sandbox` (roots, write, bash): an action has to pass both.
