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

## Naming the readings a graph is made for

A model is rarely read whole. An architecture is read for its power distribution, then for its data
flows, then for what is safety-relevant. A version 2 graph can name those readings as **viewpoints**,
so a reader selects one instead of rebuilding it type by type, and an agent writing a report draws a
figure for one instead of repeating hide lists:

```json
{
  "schema": "urn:structured-exchange:2",
  "kind": "graph",
  "viewpoints": [
    {
      "id": "power",
      "label": "Power distribution",
      "concern": "Where energy is stored, converted and consumed",
      "elementKinds": ["source", "converter", "load"],
      "relationshipKinds": ["power"]
    },
    {
      "id": "parts",
      "label": "Parts",
      "concern": "What the system is made of",
      "elementKinds": ["source", "converter", "load", "controller"]
    }
  ],
  "data": {
    "nodes": [
      { "id": "battery", "label": "Battery", "kind": "source" },
      { "id": "inverter", "label": "Inverter", "kind": "converter" },
      { "id": "motor", "label": "Motor", "kind": "load" },
      { "id": "ecu", "label": "ECU", "kind": "controller" }
    ],
    "edges": [
      { "from": "battery", "to": "inverter", "kind": "power" },
      { "from": "inverter", "to": "motor", "kind": "power" },
      { "from": "ecu", "to": "inverter", "kind": "signal" }
    ]
  }
}
```

The name is ISO/IEC/IEEE 42010's: a viewpoint frames one **concern** and retains the kinds that
address it. The concern is required, because every figure drawn for a viewpoint states it — a figure
taken out of its report still says what it is a reading of.

**A viewpoint is an inclusion.** It shows the elements and relationships whose kinds it retains, and
hides the rest. That is what keeps a kind you add to the model later out of the power viewpoint: it was
never named there. A vocabulary you name no kinds for is left whole, so `parts` above still shows every
relationship between the parts it shows. Two things it does not hide: an element or relationship that
declares no kind, exactly as no narrowing by kind hides one; and nothing about the document itself —
selecting a viewpoint is presentation only.

**What is refused, and why:**

- a viewpoint retaining a kind the document does not have — checked per vocabulary, so `power` as an
  element kind is not `power` as a relationship kind, and a kind one character off is refused rather
  than matched to the one you probably meant (`unresolved-viewpoint-kind`);
- two viewpoints sharing an `id` (`duplicate-viewpoint-identifier`);
- a viewpoint naming no kind at all (`empty-viewpoint`);
- viewpoints on a sequence or a table, which have no element and relationship kinds for one to retain
  (`viewpoints-without-graph`).

A document may declare up to twenty viewpoints, each with a concern of up to 500 characters.

To write a figure for one, name it: `write_structure_figure` with `viewpoint: "power"`. Hide lists
still apply on top, and a viewpoint the document does not declare is refused with the ones it does.

## Getting a diagram into a document

Use **download SVG**, then insert the file as a picture. Word does not accept an SVG
pasted from the clipboard — it wants a file. **copy markup** is there for the places
that do take it directly: an editor, a wiki, a repository.

(A mermaid diagram inside a Markdown *file* needs none of this, and neither does a figure the
file references: the viewer's Word export carries both into the document already, as a vector
with a raster fallback. That path does not cover structured-exchange documents, which is what
this section is about.)

The markup stands on its own. Boxes are `rect` and `text` with colours as attributes
and an explicit white ground, so what lands in the document is what was on screen. An
earlier version drew them as HTML inside `foreignObject`, which looks identical in the
browser and loses everything the moment it is serialized.

**You do not choose which way a graph runs.** A graph is laid out across the page while it
fits the reading column, and down the page when it does not — a picture nobody can read is
not a picture of your model. The reader can turn it either way, and what they export is the
way they were shown. The choice is made from the graph alone against a fixed width, never
from the size of anyone's window, so a figure written by `write_structure_figure` is turned
the same way the reader's is. Nothing about this reaches the document: the orientation is not
part of what you emit and not part of what comes back.

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

## The enriched contract, `urn:structured-exchange:2`

Everything above is version 1 and stays exactly as it is. Version 2 adds, and adds
only: change the identifier on a version 1 document and it is a version 2 document,
with one exception — `target` becomes an object, so a proposal can say which revision
it was prepared against.

Which one you emit is your choice, declared in the envelope. The application reads the
identifier and nothing else: a document carrying enriched fields under the version 1
identifier is refused, and a version 2 document that uses none of them is judged by
version 2 anyway, because that is what it says.

### What it adds

| | |
|---|---|
| `profile` | one opaque identifier naming the vocabulary that owns your kinds and attribute names |
| `attributes` | bounded, typed properties on any addressable element, relationship or row |
| `target.revision`, `expect` | what you prepared against, and what you believe is currently true |
| `locations` | where a thing can be found — a hint, never an identity |
| `artifacts` | links to related files, bound to a `sha256:` digest |
| typed rows | a table row may carry `id`, `ref` and `kind`, so it can be pointed at and patched |
| `relations` | traceability between rows, with endpoints that may leave the document |
| headings | structural rows that organise a table into chapters |

### A new artifact, described

```json
{
  "schema": "urn:structured-exchange:2",
  "kind": "graph",
  "profile": "acme/electrical",
  "data": {
    "nodes": [
      { "id": "battery", "label": "Battery", "kind": "source",
        "attributes": { "voltage": 400, "chemistry": "LFP", "suppliedBy": [{ "ref": "ORG-3" }] },
        "locations": [{ "uri": "file:///models/power.json", "range": { "startLine": 12, "endLine": 40 } }] },
      { "id": "motor", "label": "Traction motor", "kind": "actuator" }
    ],
    "edges": [{ "from": "battery", "to": "motor", "kind": "power", "attributes": { "peakKw": 150 } }]
  }
}
```

An attribute value is a string, a finite number, a boolean, `null`, a reference
(`{ "ref": "…" }`), or one flat list of those. Lists do not nest, and no other object
shape is allowed — a value the reader cannot render generically is a value that would
arrive as a shrug.

### A profile nobody recognises

```json
{
  "schema": "urn:structured-exchange:2",
  "kind": "graph",
  "profile": "https://vendor.example/profiles/sysml-ish/v4",
  "data": { "nodes": [{ "id": "b", "label": "Brake", "kind": "part",
                        "attributes": { "stereotype": "«block»", "mass_kg": 3.4 } }], "edges": [] }
}
```

This is valid, and it renders. The profile is **never fetched, resolved or executed** —
it is a name, for a reader or an authority that knows it. An unknown profile is shown
generically with its attributes as ordinary labelled values; it is not a reason to
refuse a document, and it grants no behaviour to whatever the string resembles.

### A revision-bound proposal, with expectations

```json
{
  "schema": "urn:structured-exchange:2",
  "kind": "table",
  "profile": "acme/requirements",
  "target": { "ref": "REQ-DOC-1", "revision": "rev-9" },
  "removals": [{ "type": "row", "ref": "REQ-8", "label": "Withdrawn: superseded by REQ-1" }],
  "data": {
    "columns": ["id", "requirement", "status"],
    "rows": [
      { "heading": "1. Braking", "depth": 1 },
      { "id": "r1", "ref": "REQ-1", "kind": "requirement",
        "cells": ["REQ-1", "Stop within 40 m", "approved"],
        "expect": { "revision": "rev-9", "attributes": { "status": "approved" } },
        "set": { "cells": ["REQ-1", "Stop within 35 m"],
                 "attributes": { "status": "in review" },
                 "removeAttributes": ["waiver"] } },
      { "id": "r2", "ref": "REQ-2", "kind": "requirement",
        "cells": ["REQ-2", "Read wheel speed at 100 Hz", "approved"] }
    ],
    "relations": [
      { "from": { "id": "r1" }, "to": { "id": "r2" }, "kind": "derives" },
      { "from": { "id": "r1" }, "to": { "ref": "TEST-9" }, "kind": "verifiedBy" }
    ]
  }
}
```

Four things in one row, and they are four different claims:

- **the fields beside `ref`** say what the thing is called *now*. They are how a reader
  recognises it. They are never applied.
- **`expect`** says what you believe is currently true. It is a condition for the
  receiving authority to check, not something this application has established.
- **`set`** is the only thing that changes anything.
- **`removeAttributes`** takes properties away. Deletion is explicit because `null` is
  an ordinary value: writing `null` sets a property to null, it does not unset it.

A relation's ends are stated explicitly — `{ "id": … }` for a row of this document,
`{ "ref": … }` for something outside it. An `id` that names no row is refused; a `ref`
is accepted and shown as leaving the document, because the test that verifies a
requirement usually lives somewhere else, and traceability that stopped at the document
boundary would stop exactly where it is needed.

### Locations and artifacts are addresses, not content

A `location` is navigational: a URI, optionally a revision and a zero-based line/character
range. It takes no part in identity, in endpoint resolution, or in what a proposal
addresses — move the thing and its location changes while its `ref` does not.

An `artifact` link carries `rel`, `uri`, a mandatory `sha256:` digest, and optionally a
media type and label. The digest is what makes an approval refer to stable bytes even
when the URI is mutable. **Nothing is retrieved by validation or by rendering.** A reader
who later asks to open one gets it through the application's existing resource rules,
and the bytes are hashed before use: a digest that does not match is refused rather than
shown.

### What is yours, and what is the authority's

The core validates the structural contract and the relational rules above it. It does
not, and will not:

- **check your profile's own rules.** Whether `mass_kg` is required on a `part`, or what
  `derives` may connect, belongs to the profile. Validate it in your producer, and again
  in the authority that applies the result.
- **establish that an expectation holds.** It can see that an expectation is well-formed
  and show it to a reader; only the authority holding the artifact can compare it with
  what is actually there, and it must do so immediately before applying. Approval means
  the reader approved the proposal *subject to* those conditions.
- **resolve anything you name.** Profiles, locations and artifact URIs are inert text
  until a person acts on them.

## If you are not building in this repository

You do not need our command-line interface, and you do not need this repository. The
contract ships with the package, under `contract/`:

```
node_modules/pi-outpost/dist/contract/
  schemas/structured-exchange-1.json    the normative schema — any validator runs it
  schemas/structured-exchange-2.json    the enriched contract, published beside it
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

**Concurrency, as a guarantee.** Version 2 carries what an authority needs to *detect* a
stale proposal — the revision it was prepared against, and the values it expected to
find — but detecting is the authority's act, performed against its own state at the
moment it applies. This contract transports the conditions and shows them to the reader;
it never checks them, and an approval is never evidence that they hold. Version 1 does
not carry them at all.

**A vocabulary.** Relationship kinds are opaque strings. What `calls`, `composition`,
or anything else means belongs to your domain, and enumerating it here would make a
provider-neutral contract into somebody's particular one.
