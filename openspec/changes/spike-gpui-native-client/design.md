# Design

## Context

The current product has a React client and a Fastify server joined by a typed WebSocket protocol (`shared/src/protocol.ts`). The server owns agent runtime, workspace access, credentials, and security boundaries. The CLI already owns server startup and web-launch behavior; `/health` exposes runtime health. See `proposal.md` and the delta specs for the intended behavior.

## Goals / Non-Goals

**Goals:**
- Test whether a GPUI client can implement one useful conversation flow against the existing protocol.
- Exercise a native launch path that owns only a server process it created and waits for readiness before showing the client.
- Produce a go/no-go recommendation based on protocol fit, user experience, and cross-platform/build implications.

**Non-Goals:**
- Replace the React client, redesign the server protocol, or move agent/runtime responsibilities into the native process.
- Achieve feature parity, ship a production-ready installer, or support every platform in the spike.
- Change the default `pi-outpost` web launch behavior.

## Decisions

### Keep the server authoritative; GPUI is a protocol client

The GPUI prototype connects using the existing typed WebSocket contract. Agent operations, workspace/filesystem access, authentication, and policy remain on the server. This reuses pi-outpost's established trust boundary and tests the same multi-client architecture used by the web UI. A direct SDK integration or a new native-only backend is rejected for this spike because either would test a different architecture and duplicate authority.

### Make native startup explicit and preserve the web default

Use a dedicated native launch command (provisional name: `pi-outpost desktop`) rather than changing the behavior of `pi-outpost`. The launcher starts the configured existing server when one is not already available, suppresses browser opening for that owned launch, waits for server readiness, and then launches the GPUI client. This keeps the current command compatible and makes the experiment opt-in.

### Establish process ownership before shutdown

The launcher records whether it started the server. On native-client exit it requests orderly shutdown only for its own child process and waits for termination; it never kills a reused server by port or process-name matching. Reuse must be explicit and tied to a reachable pi-outpost endpoint, not inferred solely from an occupied port. If existing server discovery cannot safely establish ownership/reuse, the spike should use an isolated server instance or report the limitation instead of terminating an unknown process.

### Use environment configuration for the direct development client

For direct spike runs, the native process reads the WebSocket endpoint from `PI_OUTPOST_URL` (default `ws://127.0.0.1:3141/ws`) and an optional token from `PI_OUTPOST_TOKEN`. The token is sent only in the Authorization header, never in argv or logs. This is an intentionally narrow development handoff; a CLI-managed server/token handoff and real-server rejection test remain outstanding. A production launcher must not infer server reuse or credentials from an occupied port or expose secrets through arguments or logs.

### Keep the vertical slice deliberately small

Implement connection, initial conversation snapshot, prompt submission, and streamed assistant/tool activity, plus visible connection/startup errors. Test the actual server protocol rather than a parallel mock contract. A likely implementation is a small Rust application/workspace for GPUI, but dependency, target-platform, and packaging feasibility are spike questions, not assumptions that justify changing the production server architecture.

## Risks / Trade-offs

- [The current WebSocket protocol may be awkward to consume from a Rust client or rely on browser-specific behavior] → Build the smallest real protocol client first and document any protocol changes needed; do not expand the spike into an unbounded protocol rewrite.
- [Finding or reusing a server may connect to an unintended instance] → Require explicit endpoint/auth configuration or a safe identity/readiness handshake; never infer ownership from a listening port alone.
- [Process termination may leave orphaned servers or stop a user's server] → Track the spawned child handle and terminate only that child; verify normal close and forced client exit behavior.
- [GPUI/build dependencies may limit platform coverage] → Pick one initial desktop platform for the prototype and record portability constraints before recommending production adoption.
- [The existing server token may need a secure handoff to a native child] → Do not put secrets in command-line arguments or logs; use a protected local mechanism and retain server-side authentication.

## Migration Plan

No production migration is required. Keep the native client and launch command experimental and opt-in. If the spike is rejected, remove the experimental target and launcher path without changing the existing server, protocol, or web launch. If accepted, propose a follow-up change for supported platforms, packaging, authentication handoff, lifecycle semantics, and broader feature scope.
