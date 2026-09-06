# Structured exchange — for producers

A tool can return structured data alongside its text, and this application will render
it natively: a graph, a sequence, or a table, drawn from the data rather than from
anything the tool wrote for display. When the document names a target it is read as a
*proposal* to change something an external authority holds, and its rendering becomes
the approval gate before that change is applied.

This page is for whoever writes such a producer. The normative contract is
[`shared/schemas/structured-exchange-1.json`](../shared/schemas/structured-exchange-1.json).

## The two payloads, and why you owe both

A tool result carries two things, and they go to different readers:

| Channel | Reaches | Carries |
|---|---|---|
| the result's text content | **the model** | what the agent will reason about later |
| `details` | **the interface only** | the structured document |

The SDK defines `details` as metadata the LLM does not see. That is what makes it the
right home for a 500-element graph — the model pays nothing for it — and it is exactly
why the text half is not optional.

**A producer that emits only the structured document leaves the agent with nothing to
reason about.** It will render beautifully and be useless on the next turn, when the
agent is asked a follow-up question about a structure it cannot see. Summarise the
structure in the text: what it contains, what changed, what matters.

The reverse also holds: text alone gets you today's behaviour, a wall of prose.

## Describing is not changing

On anything carrying a `ref`, the fields you declare beside it **describe what the
authority already holds**. They are how a reader recognises the thing. They are not
applied. An intended change goes in `set`:

```json
{ "id": "ledger", "ref": "EL-7", "label": "Ledger",
  "set": { "label": "General Ledger" } }
```

Two consequences worth stating plainly.

**Include as much context as the reader needs.** Elements carried purely so the
proposal can be situated cost nothing and change nothing. A proposal nobody can place
is a proposal nobody should approve.

**The default runs this way round because producers forget.** Were a declared field
taken as an intended change, a producer including twenty elements for context would be
proposing twenty renames to the names those elements already have — and the reader,
seeing them marked as changes, could approve them. This way a forgotten `set` changes
nothing and somebody says "it didn't work". A generative producer's mistakes have to
fail inert.

A `set` on something with no `ref` is refused: there is nothing there to change, and
its fields are already its values.

## Emitting a document

Put the envelope in your tool result's `details`:

```js
return {
  content: [{ type: "text", text: "Billing now calls Ledger. 12 elements, 1 added." }],
  details: {
    schema: "urn:structured-exchange:1",
    kind: "graph",
    data: {
      nodes: [{ id: "billing", label: "Billing" }, { id: "ledger", label: "Ledger" }],
      edges: [{ from: "billing", to: "ledger", kind: "calls" }],
    },
  },
};
```

The server forwards anything whose `schema` starts with `urn:structured-exchange:`
and validates nothing — validation happens where the rendering decision is made.

## The agent as a producer

The agent can author these too, guided by [`skills/structured-exchange`](../skills/structured-exchange/SKILL.md).
It presents one through the `present_structure` tool, which validates before showing
anything and hands back the diagnostics when it refuses, so a document can be corrected
without leaving the exchange.

## Validating before you emit

```
node contract/validate-structured-exchange.mjs document.json
cat document.json | node contract/validate-structured-exchange.mjs
```

One file, no install, no checkout: the schema and the rules are inside it. In this
repository, build it with `npm run build:validator` and find it at
`shared/dist/validate-structured-exchange.mjs`.

| Exit | Meaning |
|------|---------|
| `0` | the document conforms |
| `1` | the document was read and parsed, and does not conform |
| `2` | the input could not be read at all |
| `3` | the input was read and is not JSON |

The last three are separated on purpose. A missing file, a truncated write and a
document that says the wrong thing send you looking in three different places, and a
build that collapses them into "invalid" sends you to the schema for a problem that
is not there.

Diagnostics name the rule and point at the value:

```json
{"valid": false, "issues": [
  {"rule": "unresolved-endpoint", "path": "/data/edges/0/to",
   "message": "\"ledgr\" is not an identifier declared in /data/nodes"}
]}
```

Every broken rule is reported, not just the first.

## Grouping graph and sequence elements

Graphs and sequences may declare `data.containers`, then assign a node or participant with
its `container` field:

```json
{
  "schema": "urn:structured-exchange:1",
  "kind": "graph",
  "data": {
    "containers": [{ "id": "backend", "label": "Backend", "kind": "service-group" }],
    "nodes": [{ "id": "billing", "label": "Billing", "container": "backend" }],
    "edges": []
  }
}
```

A container groups elements visually; it is not itself an element or relationship endpoint.
Container identifiers must be unique, and every `container` reference must resolve to one
declared in the same document. Moving an existing element between containers is a change, so
put the new container id under `set.container` beside that element's `ref`.

## Getting a diagram into a document

Use **download SVG**, then insert the file as a picture. Word does not accept an SVG
pasted from the clipboard — it wants a file. **copy markup** is there for the places
that do take it directly: an editor, a wiki, a repository.

(A mermaid diagram inside a Markdown *file* needs none of this: the viewer's Word export
carries it into the document already, as a vector with a raster fallback. That path does not
cover structured-exchange documents, which is what this section is about.)

The markup stands on its own. Boxes are `rect` and `text` with colours as attributes
and an explicit white ground, so what lands in the document is what was on screen. An
earlier version drew them as HTML inside `foreignObject`, which looks identical in the
browser and loses everything the moment it is serialized.

## A table that reports a change

A table cannot be proposed — it has no identity per row for a patch to join against,
and an envelope declaring a table with a `target` or a `removal` is refused. It can
still report on a change it projects. Any row may declare what it plays:

```json
{
  "rows": [
    { "role": "added",   "cells": ["REQ-5", "Log every actuation.", "draft"] },
    { "role": "changed", "cells": ["REQ-2", "Signal a fault within 200 ms.", "in review"] },
    { "role": "removed", "cells": ["REQ-3", "Read battery voltage at 10 Hz.", "withdrawn"] },
    { "cells": ["REQ-1", "Stop within 40 m.", "approved"] }
  ]
}
```

`role` is `added`, `changed`, `context` or `removed`, and it is rendered with the
colours a graph uses for the same words. A row that declares none reads as context
among rows that do. Both row forms are accepted for the life of version 1, so
`["REQ-1", "…"]` and `{ "cells": ["REQ-1", "…"] }` are the same row and a table that
declares no role anywhere renders exactly as it did before roles existed.

Declare the role rather than encoding it in a column. A `status` column of your own
vocabulary is data, and is rendered as data — nothing infers a role from a cell.

A reader can switch a role off from the key, which narrows the table to the rows that
remain, and can take the table away with **download CSV** or **download XLSX**. Where
rows declare roles, both exports carry a `change` column, because the colour that
states the role in the rendering does not survive the crossing. A narrowed table
exports only what it shows, and the controls say so.

Old consumers: a copy of the widget published before roles existed validates against
its own committed schema, so a role-carrying table is refused there and the tool
result falls back to raw output. It degrades; it does not break.

## If you are not building in this repository

You do not need our command-line interface, and you do not need this repository. The
contract ships with the package, under `contract/`:

```
node_modules/pi-outpost/dist/contract/
  schemas/structured-exchange-1.json    the normative schema — any validator runs it
  conformance/                          documents and the verdict each should get
  validate-structured-exchange.mjs      the reference validator, self-contained
  README.md                             this page
```

- The **schema** is what the application validates against, byte for byte: it is the
  same file, copied at build time rather than restated.
- The **conformance suite** covers the relational rules JSON Schema cannot express.
  Run your implementation against it; if it agrees on every case, it conforms.
- The **validator** is the reference implementation of both, bundled with everything
  it needs. Use it as a check on your own, or as the check itself.

In this repository the same two live at `shared/schemas/` and `shared/conformance/`.

## Where the document has to be put

On `details` of a tool result. That is the whole channel, and it is deliberate:
`details` is filled by a tool's implementation and never by the model, so a proposal
shown as an approval gate was produced by code rather than written by the thing whose
work is being reviewed.

```js
return {
  content: [{ type: "text", text: "Billing now calls Ledger. 12 elements, 1 added." }],
  details: envelope,
};
```

**There is no MCP path.** The agent SDK underneath has no MCP client — it says so
outright and points anyone who wants one at writing an extension. So if you are
bridging a model-context server into this, the bridge is yours to write, and it meets
this contract by returning the envelope in `details` of its own tool result. Nothing
here reads MCP's `structuredContent`, because nothing in this process produces it.

Relay it unchanged. A bridge that reshapes what it passes through is a second
producer, and the reader would be approving its work rather than the original.

## What is deliberately not here

**Delivery.** How an approved proposal reaches the authority that applies it, and what
that authority reports back, is a separate contract. What this one guarantees is that
an approved proposal survives unaltered and can be recovered exactly as it was
validated — the precondition any delivery mechanism needs.

**Concurrency.** A document names *which* artifact it targets, not which revision. A
proposal built from a stale export and applied late is the receiving authority's to
detect; this contract does not carry what it would need to do so.

**A vocabulary.** Relationship kinds are opaque strings. What `calls`, `composition`,
or anything else means belongs to your domain, and enumerating it here would make a
provider-neutral contract into somebody's particular one.
