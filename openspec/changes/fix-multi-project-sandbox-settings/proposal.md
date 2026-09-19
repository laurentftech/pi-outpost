## Why

With several projects open, Settings shows one "Sandbox" section holding the server's sandbox — the first project's root — whatever project is being looked at, and Apply sends all of it back. Two consequences. Applied from a second project, it rebuilt that project's tools and file browser with the first project's root: its agent worked in the wrong directory, with the configuration's write permission. And every Apply, even of nothing, rewrote the sandbox section, root included, into the configuration file — the section the user saw "recreated". In multi-project the section contributes only the agent's permissions; each project is already confined to its own directory.

## What Changes

- **Each project keeps its own directory.** Applying Settings from a project other than the server's own, or with several projects open, takes only the permissions (write, bash); the roots are left as they are, and the project is rebuilt inside its own directory.
- **An unchanged sandbox is not a change.** The server neither writes nor reapplies a sandbox sent back unchanged, and the Settings panel offers Apply only once something in the section has changed.
- **Settings shows what applies.** With several projects open — or from a project that is not the server's own — the section reads "Agent permissions", states the folder this project is confined to, and offers no root or writable root to edit. A single project keeps the full section, `writableRoot` included.

## Capabilities

### Modified Capabilities

- `persistent-runtime-settings`: new requirements on Settings applied from a project that does not own the sandbox root, on an unchanged sandbox, and on what the panel shows with several projects open.

## Impact

- `server/src/index.ts` — `sandboxFor`, `rootEditableFrom`, `handleUpdateConfig`; the snapshot's `sandbox.projectRoot` and `sandbox.rootEditable`.
- `shared/src/protocol.ts` — the two snapshot fields.
- `ui/src/components/SettingsMenu.tsx` — permissions-only section, Apply only on change.
- No configuration format change: `sandbox` keeps its keys; `writableRoot` stays a single-project setting.
