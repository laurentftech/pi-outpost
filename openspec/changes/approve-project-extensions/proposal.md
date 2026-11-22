## Why

Letting the agent write its own pi extensions is part of what pi is. But an extension is a module pi imports into the server's own process: it runs outside the sandbox, with every right of the user's account and the provider keys within reach. pi-outpost loads the project's `.pi/` without asking — pi's project-trust question exists only in the pi CLI, and an SDK host's settings start trusted — and loads it again on every new conversation, conversation switch, project switch, session restart or settings change, not only at a server restart.

Verified under MXC's real executor: a confined command, unable to write outside its root, wrote `.pi/extensions/x.ts`; creating the next session's services ran it in the server, which wrote outside the root. pi-outpost's file tools already refuse `.pi/`; its confined shell does not, and should not have to: writing an extension stays allowed. What is missing is the user's say before it runs.

## What Changes

- Before pi-outpost creates a session's services, it lists the project's extensions — auto-discovered under `.pi/extensions/` (files, and a directory's entry), the extensions `.pi/settings.json` names, and its `packages` — each with a hash of what would be loaded.
- One not approved for that exact content is **not loaded**: pi-outpost gives pi a settings manager whose project settings add an exact `-<path>` exclusion for it, and leave out an unapproved package before pi installs it. Verified with pi 1.6.0: an excluded extension is neither imported nor run, through a reload too.
- The interface asks, per extension: its path and size, **"It will run outside the sandbox, with every right of your account"**, *View code*, *Allow*, *Refuse*. Allowing reloads the session with it. A changed file asks again.
- Approvals and refusals are kept by the server, outside every sandbox, per project, by path and content hash; Settings lists them, and either can be withdrawn.
- Without anyone to ask (`-p`), an unapproved extension is not loaded, and stderr says which and how to allow it.
- Installing a package into the project from Settings is the user's own hand: it is allowed by that act, not asked about. Extensions of the agent's own scope (`~/.pi/agent`) are not concerned.

## Capabilities

### New Capabilities

- `project-extension-approval`.

## Impact

`server/src/index.ts` (the runtime factory and its settings manager), a new `server/src/extensionApproval.ts`, the protocol (a question and its answer), a dialog and a Settings section in `ui/`. A project's existing extensions ask once, on first open after the update. The `rpc` runtime is out of scope: its child loads `.pi/` itself.
