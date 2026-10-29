# Defer diagram, poster and structure tools

## Why

Diagram checking, poster checking and picture inspection, and structured-exchange writing tools are useful only for particular tasks, but their schemas are currently included in every agent request. Deferring them keeps their descriptions out of the prompt until needed while leaving them available through `tool_search`.

## What Changes

- Register `drawio_check`, `poster_check`, `poster_pictures`, `compare_timelines`, `write_structure_figure` and `write_structure_table` with `deferred` exposure in both runtimes.
- Tell the agent that diagram, poster and structured-exchange tools can be loaded with `tool_search`.
- Keep the tools callable through the existing sandbox and tool execution paths, and verify the search can load each of the six tools.
- Update the resting tool-cost documentation to account for their deferred schemas.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `agent`: define when the diagram, poster and structured-exchange tools are declared and how the agent can load them.

## Impact

- `server/src/documentTools.ts`: deferred tool inventory.
- `server/src/systemPrompt.ts`: guidance for finding these tools.
- `server/test/deferredTools.test.ts`, runtime tool-registration tests, and prompt tests.
- `server/scripts/probe-context-baseline.mts` and `docs/comparison.md`: measured resting tool cost and deferred schema sizes.
