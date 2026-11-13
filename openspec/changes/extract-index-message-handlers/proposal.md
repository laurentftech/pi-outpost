# Proposal

## Why

`server/src/index.ts` is the central WebSocket entry point and also owns large Git, file-browser/search, package, agent-resource, and session/history handler families. OpenLore reports `handleClientMessage` at risk 100/100, with fan-out 113 and blast radius 503; extracting roughly 2,000 lines of cohesive handlers gives the main server entry point clearer ownership boundaries while preserving the existing client/server contract.

## What Changes

- Extract Git message handling into a dedicated server module.
- Extract file browsing and content/file search message handling into a dedicated server module.
- Extract Pi package lifecycle message handling into a dedicated server module.
- Extract agent-resource repository message handling into a dedicated server module.
- Extract session listing, mutation, history, search, naming, and tree message handling into a dedicated server module.
- Keep `server/src/index.ts` responsible for WebSocket lifecycle, workspace binding, shared policy, and routing messages to the domain handlers.
- Pass shared services and callbacks through typed dependency contexts; extracted modules must not import `server/src/index.ts`.
- Preserve all message names, payloads, request IDs, ordering, error responses, cancellation, and workspace isolation. No externally observable behavior or wire-protocol change is intended.
- Keep the existing low-level modules and protocol as the source of truth; do not duplicate Git, file-browser, package, resource-repository, or session operations.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. This is a structural refactor with no requirement-level behavior change. `skip_specs: true` is set for this change so the proposal does not create artificial delta requirements.

## Impact

- **Server source**: `server/src/index.ts`; new sibling modules `server/src/gitMessageHandlers.ts`, `server/src/fileBrowserMessageHandlers.ts`, `server/src/piPackageMessageHandlers.ts`, `server/src/agentResourceMessageHandlers.ts`, and `server/src/sessionMessageHandlers.ts`.
- **Cross-call-site wiring**: the WebSocket dispatcher and any existing callers outside the dispatcher, notably content-search cancellation and automatic session naming, must be updated without making feature modules depend on `index.ts`.
- **Existing modules reused**: `server/src/git.ts`, `server/src/fileBrowser.ts`, `server/src/piPackages.ts`, `server/src/resourceRepositories.ts`, and session services.
- **Tests**: existing server wire and domain suites for Git, file browsing/search, Pi packages, agent resources, sessions, and history, followed by `npm test --workspace server`.
- **No changes intended**: `shared/src/protocol.ts`, frontend message handling, APIs, configuration, dependencies, and documentation.
- **Risk**: high because the dispatcher is a central integration point and some extracted helpers have callers outside its switch. Make the extraction incrementally, keep each source edit to at most 50 contiguous lines, and run the server test gate after each domain-level extraction before proceeding.
