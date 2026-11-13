# Design

## Context

See `proposal.md` for the motivation and scope. `handleClientMessage` in `server/src/index.ts` is the typed WebSocket router; most domain operations already delegate to cohesive lower-level modules such as `git.ts`, `fileBrowser.ts`, `piPackages.ts`, and `resourceRepositories.ts`. The handlers being considered for extraction currently share `Workspace` (defined in `server/src/workspace.ts`), socket response delivery, broadcasts, and a small number of server lifecycle callbacks. Some helper functions also have callers outside the dispatcher: content-search cancellation is used by binding/connection lifecycle code, automatic session naming is triggered from runtime events, and package refresh is called from workspace startup.

## Goals / Non-Goals

**Goals:**

- Move roughly 2,000 lines of cohesive wire-handler logic out of `index.ts` into five domain-specific sibling modules.
- Make each module depend on typed workspace/service/callback inputs rather than importing the server entry point.
- Keep `index.ts` responsible for server and WebSocket lifecycle, binding/policy, shared orchestration, and routing.
- Preserve the existing protocol and all observable behavior, including errors, request IDs, side-effect order, broadcasts, and cancellation.
- Reuse existing domain services and existing wire/integration tests.

**Non-Goals:**

- Change ClientMessage or ServerMessage types, frontend behavior, routes, configuration, or public APIs.
- Rewrite the domain operations already implemented in the lower-level modules.
- Move unrelated runtime, credentials, sandbox, terminal, workspace lifecycle, or outcome-composition handlers.
- Add a generic handler framework or a single catch-all module that would reproduce the central file's coupling.

## Decisions

### Use five domain-specific message modules

Create `gitMessageHandlers.ts`, `fileBrowserMessageHandlers.ts`, `piPackageMessageHandlers.ts`, `agentResourceMessageHandlers.ts`, and `sessionMessageHandlers.ts` beside `index.ts`. Each module owns its domain-specific message handling and private helpers, and exports only the handler entry points or lifecycle helpers required by external callers.

**Alternatives considered:** keeping all functions in `index.ts` and extracting only the switch, which would leave the implementation bulk and domain ownership in the central file; or one generic handler module, which would simply relocate the monolith. The five domains match existing protocol/test areas and reusable lower-level modules.

### Pass narrow typed dependencies; do not import from `index.ts`

Define a small context type per domain. Contexts may use the existing `Workspace` type from `workspace.ts` and explicit callbacks for socket sends, workspace broadcasts, server-wide errors, restart notifications, or refresh operations. Keep lifecycle-owned callbacks in `index.ts` and pass them at the boundary where necessary. Do not introduce a dependency from an extracted handler module back to `index.ts` or duplicate `Workspace` state.

**Alternatives considered:** exporting internal symbols from `index.ts` for modules to import, which creates a circular dependency; moving broad server state into a new shared container, which expands the refactor and obscures ownership; or making a single oversized context, which makes each domain depend on unrelated services.

### Preserve cross-call-site helpers as module exports with injected callbacks

Keep content-search cancellation available to the connection/binding lifecycle after it moves with file search. Keep session auto-naming callable from runtime-event handling after it moves to the session module. Keep package refresh callable from workspace startup, and inject restart-reason notification into package and resource handlers. These are narrow exports/callbacks; the modules remain independent of the entry point.

**Alternatives considered:** leaving these helpers behind in `index.ts`, which splits ownership of the same domain; or importing the entry point from the domain module, which risks cycles.

### Extract incrementally and preserve the dispatcher as the protocol boundary

Move one domain at a time, in this order: Git, file browser/search, Pi packages, agent resources, sessions/history/tree. After each domain, inspect the diff, run its focused suites, and run the full server suite before moving to the next. Keep each source edit bounded to at most 50 contiguous lines. Leave `get_outcome` and unrelated message cases in `index.ts`.

**Alternatives considered:** moving all domains in one large change, which makes protocol drift and regressions harder to localize; and moving session handlers first, which touches the most stateful and cross-called area before the extraction pattern is proven.

## Risks / Trade-offs

- [High coupling at the WebSocket boundary] → Keep parsing, workspace selection, shared policy, and unknown-message handling in `index.ts`; add no new message types.
- [A call site outside the dispatcher is missed] → Update and search all callers of moved helpers, particularly `abortContentSearch`, `maybeNameSession`, and `refreshPiPackages`, before deleting their original definitions.
- [Response order or side effects shift during movement] → Move bodies without semantic edits; retain existing request/response assertions and run focused suites plus `npm test --workspace server` after each domain.
- [Typed contexts become a back door for the whole server] → Keep them domain-specific and pass the smallest operations required; do not pass the module namespace or import `index.ts`.
- [The size estimate is approximate] → Confirm the final net line reduction from the actual diff; do not expand the refactor into unrelated `index.ts` sections to meet an exact count.

## Migration Plan

There is no data or external API migration. Extract each domain in the order above. For each domain, update all callers atomically with the extraction, run its focused tests, then run `npm test --workspace server`; stop and repair that domain if either gate fails. After all five domains, run `npm run typecheck --workspace server`, the full server suite, and compare the final diff/line count to the intended scope. Roll back the current domain's changes if its gate remains failing after diagnosis; earlier green domain extractions remain independently revertible.
