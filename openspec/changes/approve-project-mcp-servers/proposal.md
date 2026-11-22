## Why

pi's built-in MCP extension reads the project's `.pi/mcp.json` in a trusted project, and for pi-outpost every project is trusted. A stdio server there is a command the server starts, unconfined, as the session opens — no prompt needed. Shown on `main`: a server written into the project's `.pi/mcp.json` started when a client connected. `approve-project-extensions` gated the project's extensions and packages, not this file.

## What Changes

- The servers the project's `.pi/mcp.json` defines are candidates like its extensions: keyed by name, hashed by their configuration, asked about, allowed or refused, a change asking again. A project entry that only overrides a global server's switches is not one.
- pi-outpost already builds pi's MCP extension itself; it now gives it a `loadConfig` that leaves out the project's servers not allowed for their current configuration, checked again when the extension reads it.
- The dialog says "This project asks pi to start an MCP server", its command or URL, and shows `.pi/mcp.json`.

## Capabilities

### Modified Capabilities

- `project-extension-approval`: adds `AProjectMcpServerDoesNotStartUntilAllowed`.

## Impact

`server/src/extensionApproval.ts`, `server/src/index.ts` (the MCP extension's factory), `server/src/workspace.ts`, the protocol's kind (`"mcp"`), `ui/src/components/ExtensionApprovalDialog.tsx`, `docs/sandboxing.md`.
