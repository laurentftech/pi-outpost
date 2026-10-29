# Design

## Context

Both runtimes already pass their tool definitions through the shared `deferOnDemandTools()` helper. The current worktree adds the six requested names to `DEFERRED_TOOLS`; the shared system prompt still describes only document tools and the project model. `tool_search` is the existing mechanism for loading deferred tools, and the tool definitions already contain their own descriptions.

## Goals / Non-Goals

**Goals:** Keep the six schemas out of requests until loaded, make their availability discoverable, and prove this behavior in both runtimes.

**Non-Goals:** Change any tool's inputs, outputs, validation, sandbox boundary, or the rules governing when a tool is invoked.

## Decisions

- Keep these names in the shared `DEFERRED_TOOLS` inventory. Both the embedded and RPC runtimes already use `deferOnDemandTools()`, so one inventory governs registration in both places.
- Extend `DEFERRED_TOOLS_GUIDANCE` with diagrams, posters and structured-exchange tools. Keep that guidance conditional on `tool_search` being available, as it is today.
- Verify each tool through the real `tool_search` ranker with a purpose-based query, and verify declarations before and after loading at the runtime boundary. This catches both missing registrations and descriptions that make a deferred tool undiscoverable.
- Update `docs/comparison.md` from the measured resting tool set after the schemas are deferred.

## Risks / Trade-offs

- [The model may still fail to search for a needed tool] → Name the tool families in system guidance and test that purpose-based searches load each definition.
- [The guidance adds a small fixed prompt cost] → Include the updated resting cost in `docs/comparison.md`.

## Migration Plan

No migration is needed. Existing sessions receive the updated deferred inventory and guidance when they create a new agent session.
