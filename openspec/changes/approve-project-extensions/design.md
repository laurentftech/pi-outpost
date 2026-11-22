# Design

## Context

pi 1.6.0 picks the extensions to import in its package manager, from three sources: auto-discovery under `<project>/.pi/extensions/` (a file, or a directory's `index.ts`), the `extensions` entries of `.pi/settings.json` (a path anywhere), and the extensions of its `packages` (installed with npm or git first). Each is filtered by the `extensions` patterns of the project settings, read through `SettingsManager.getProjectSettings()`; `createAgentSessionServices` takes the host's `SettingsManager`. Its `extensionsOverride` filters after import, when the module's top-level code has already run, so it cannot be the gate. Its project trust is all or nothing (skills, prompts and `SYSTEM.md` too), and an SDK host is trusted by default.

## Decisions

### The gate is the project settings pi reads

pi-outpost's `SettingsManager` answers `getProjectSettings()` with the file's settings plus `-<absolute path>` for each extension not approved, and without the packages not approved. `-` is pi's exact force-exclude, which wins over any include the project's own settings write. Verified: a file, a directory's `index.ts` and a path named in `.pi/settings.json` are neither imported nor run, at creation and on `reload()`.

### Listing without loading

The candidates are found the way pi finds them, without importing: pi's `resolve()` on a settings manager whose project `packages` are withheld (so nothing is installed just to be listed), keeping entries of `project` scope. A package is a candidate by its source string as written; its files are hashed once installed, on the reload that follows its approval.

### Approval is of content, not of a name

An approval records the real path and a SHA-256 of the file — of every file under a directory extension. Any change asks again. Refusals are recorded the same way, so a refused extension is not asked about at every new conversation; changing it asks again.

### Held outside every sandbox

Approvals live in the server's per-project state, beside the durable sandbox rules: never in the project tree, never in the configuration file, out of a confined command's reach.

### Asked through the session's question channel

The question uses the channel the sandbox grants use: shown in every open browser of the project, answered once. A session whose extensions wait for an answer starts without them, and says so in the transcript; allowing reloads it (as "restart session" does), refusing leaves it as it is.

### When it applies

Whenever pi-outpost runs the session embedded. Without a sandbox the agent can write the approvals too, but asking costs one dialog and the default is the safe one.

## Risks

- A project's existing extensions ask once after the update: said in the changelog.
- An extension can `import` other files of the project: those are hashed as part of a directory extension, not for a single file importing a sibling. The dialog says "and what it imports".
- The pi CLI run directly in the folder uses its own trust, not these approvals.
