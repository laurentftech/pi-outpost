## Why

An Open WebUI model created a planning with `schema`, `kind` and `title` inside `data`. The answer
listed eight diagnostics: `data` lacked `nodes` and `edges`, `participants` and `messages`, `columns`,
and carried properties it should not. Without a top-level `kind`, the contract's schema cannot tell
which form `data` takes, so it tries the graph, sequence, table and timeline forms and reports every
failure. Nothing in the answer said the one thing to fix, and the model, reading about nodes and
edges, was lost.

A planning can only be a version 3 timeline, so a wrong envelope has exactly one fix, and it can be
named.

## What Changes

- The planning gate (`judgePlanning`, shared by the Open WebUI and MCP servers) settles the envelope
  before asking the contract:
  - `schema` or `kind` found inside `data` and missing beside it → `planning-envelope` at
    `/data/schema` or `/data/kind`, saying it belongs beside `data`, with the form to write. The rest
    of the planning is then judged as if they were in place, so the contract's diagnostics for it
    arrive in the same answer.
  - `kind` other than `timeline` or `schema` other than version 3, missing or wrong, wherever they
    were found → `planning-is-a-timeline` alone, naming the field and the form to write. The
    contract's diagnostics for other forms are not sent.
- What is accepted and refused does not change: every document refused before is refused, and none
  is accepted that was not. Only the diagnostics for a wrong envelope differ from pi-outpost's.

## Impact

- `apps-core/src/planning.ts` (`judgePlanning`, `envelopeIssues`).
- Tests: `openwebui/test/plannings.test.ts`, `mcp/test/tools.test.ts`.
- Documentation: `docs/openwebui.md` (its promise of the same refusal reasons as pi-outpost now names
  the one planning-specific wording).
