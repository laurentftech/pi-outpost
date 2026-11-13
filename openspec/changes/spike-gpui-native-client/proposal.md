# Proposal

## Why

pi-outpost currently presents its agent through a React web client. A native GPUI client could provide a more application-like desktop experience, but its feasibility, fit with the existing protocol, and operational cost are not yet established. A bounded spike will answer those questions without replacing the current server or web interface.

## What Changes

- Add an experimental GPUI desktop client as a separate client of the existing pi-outpost server and typed WebSocket protocol.
- Add a dedicated launch path that starts the existing server when needed, waits until it is ready, and then opens the native client; preserve the existing default web launch behavior.
- Define ownership and shutdown behavior so the launcher stops only a server process it started, not a pre-existing server.
- Prototype a narrow end-to-end conversation flow and record technical findings, limitations, and a recommendation on whether to continue.
- Keep the spike explicitly non-parity: do not port the full React interface or replace/refactor the agent runtime.

## Capabilities

### New Capabilities
- `native-desktop-client`: Experimental native client lifecycle and a minimal agent conversation over the existing server protocol.

### Modified Capabilities
- `cli`: Add a dedicated command or option for launching the native client while retaining the current web-server startup behavior by default.

## Impact

- Existing CLI and server startup lifecycle, including readiness detection and process shutdown.
- `shared/src/protocol.ts` and the WebSocket contract, which the GPUI client must consume without bypassing server-side agent, filesystem, or security boundaries.
- New native-client source/build tooling and platform-specific GPUI dependencies, to be assessed during the spike.
- Existing web UI and server behavior should remain unchanged for current launch paths.
