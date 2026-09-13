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

- **check your profile's own rules.** Whether `mass_kg` is required on a `part`, which
  values `status` may take, or what `derives` may connect belongs to the profile, and the
  core contract checks none of it. A project running this application can hold the agent's
  documents to the kinds, attributes and enumeration values it declares — see
  [Holding documents to a project's data model](#holding-documents-to-a-projects-data-model)
  — but not to endpoint rules. Validate in your producer too, and again in the authority
  that applies the result.
- **establish that an expectation holds.** It can see that an expectation is well-formed
  and show it to a reader; only the authority holding the artifact can compare it with
  what is actually there, and it must do so immediately before applying. Approval means
  the reader approved the proposal *subject to* those conditions.
- **resolve anything you name.** Profiles, locations and artifact URIs are inert text
  until a person acts on them.

## Holding documents to a project's data model

The core contract treats `profile` as a name. A project can go further: declare its data
model — the kinds that exist, the attributes each carries, the values each enumeration
allows — in files it keeps, and this application's agent tools then refuse a document that
strays from it exactly as they refuse one that breaks the contract: with the rule, a pointer
to the value, and what the model allows there. The agent corrects and presents again within
the same turn; an invented enumeration value never reaches the reader.

Nothing is fetched. The registry and its profiles are files in the project, read on every
call — an edited profile applies to the next document — and a document's `profile` is
matched against them as an exact string, never resolved.

### The registry

`.pi-outpost/structured-exchange.json`, at the project root:

```json
{
  "schema": "urn:structured-exchange-profile-registry:1",
  "profiles": ["profiles/requirements.json"],
  "rules": ["rules/review.json"],
  "default": "acme/requirements"
}
```

`rules` is optional; see [Rules a project reviews against](#rules-a-project-reviews-against).
Profile and rules paths are relative to the project directory and must stay inside it, links
included. Files are listed rather than discovered, so a stray file is never a rule and a
missing one is an error. A project with no registry is unconstrained, as before.

### A profile

Its format is `urn:structured-exchange-profile:1`, published with the other schemas:

```json
{
  "schema": "urn:structured-exchange-profile:1",
  "id": "acme/requirements",
  "label": "ACME requirements model",
  "elementKinds": [
    {
      "kind": "requirement",
      "attributes": [
        { "name": "status", "type": "enumeration", "values": ["draft", "approved", "withdrawn"], "closed": true, "required": true },
        { "name": "priority", "type": "enumeration", "values": ["must", "should", "could"], "closed": false },
        { "name": "owner", "type": "string" },
        { "name": "verifiedBy", "type": "reference", "list": true },
        { "name": "category", "type": "enumeration", "values": ["derived", "refined", "direct"], "closed": true },
        { "name": "safety", "type": "enumeration", "values": ["yes", "no"], "closed": true }
      ]
    },
    { "kind": "test" }
  ],
  "relationshipKinds": [{ "kind": "derives" }, { "kind": "verifies" }, { "kind": "satisfies" }],
  "viewpoints": [
    { "id": "verification", "label": "Verification", "concern": "What verifies each requirement", "elementKinds": ["requirement", "test"], "relationshipKinds": ["verifies"] }
  ]
}
```

- `elementKinds` govern graph elements **and** table rows; `relationshipKinds` govern graph
  relationships **and** table relations. A requirement is the same thing drawn as a box or
  listed as a row.
- An attribute is a `string`, `number`, `boolean`, `reference` or `enumeration`; `list`
  makes it a list of that type. `required` means *has a value*: `null` is not one.
- An enumeration lists its `values` and must say whether it is `closed` — a value outside
  it refused — or open, where such a value is accepted and reported.
- Kinds and attributes are arrays of named entries, not maps: a kind or attribute declared
  twice is refused instead of silently keeping the last.
- `viewpoints` are the readings the domain's models are made for, in the shape a document
  declares them; the agent can draw a figure for one of them from any document held to the
  profile.

### What is refused, and what is only reported

A version 2 graph or table held to a profile is refused when it breaks one of these, and
each refusal states what the profile allows at the place it points:

| Rule | When |
|---|---|
| `profile/undeclared-kind` | a kind the profile does not declare in that vocabulary |
| `profile/missing-kind` | an element, relationship, relation or non-heading row with no kind — a changed item states its kind too |
| `profile/undeclared-attribute` | an attribute the item's kind does not declare |
| `profile/attribute-type` | a value of the wrong type, or a list where one value is declared, or the reverse |
| `profile/closed-enumeration` | a value outside a closed enumeration |
| `profile/missing-required-attribute` | an item of a complete document, or one a proposal adds, without a required attribute |
| `profile/null-required-attribute` | a required attribute set to `null` |
| `profile/required-attribute-removed` | a proposal removing a required attribute |
| `profile/unregistered-profile` | under a default, a document naming a profile the project does not register |
| `profile/version-1-under-default` | under a default, a version 1 document, which cannot name a profile |
| `profile/viewpoint-declared-twice` | a document declaring a viewpoint its profile also declares |

A proposal is not refused for required attributes it does not mention on an item it
changes: it describes only what changes. A value outside an **open** enumeration is not
refused; the agent is told each one with the values the enumeration lists, so it can tell a
new value from a typo. Structural heading rows and sequence documents are not held to a
profile.

### What a default changes

Without `default`, profiles are opt-in: a document naming a registered profile is held to
it, and anything else — no profile, an unknown one, version 1 — is judged by the core
contract alone. With a default, the project has said its documents follow a model, and a
document may not step around it: one naming no profile is held to the default, one naming a
profile the project does not register is refused, and a version 1 document is refused.

### When the registry is wrong

A registry that is not JSON or not a registry, a listed file that is missing, outside the
project or not a usable profile, two files declaring one identifier, or a default nothing
registers: the agent's tools then refuse **every** document, naming the rule (`registry/…`
or `profile-format/…`), the file and a pointer into it. They never fall back to the core
contract alone — a mistake in the registry would otherwise remove every guarantee while
everything looked fine.

### What the reader sees

A presented document held to a profile says so beside its vocabulary, and in its text
equivalent: that it conforms (with how many values fell outside open enumerations, and how
many findings its rules leave to check), that it
does not conform to the profile as it stands now, or that it could not be checked because
the registry cannot be used. The statement is re-established each time the document is
shown, so a proposal restored after the profile was tightened says it no longer conforms. It
travels beside the document and never changes it.

### Building a profile outside this application

A profile is usually built where the model lives — exported from a requirements tool, or
composed by an agent from one — and checked there, with the reference validator that ships
in the package:

```
node validate-structured-exchange.mjs --check-profile profiles/requirements.json
node validate-structured-exchange.mjs --describe-profile profiles/requirements.json
node validate-structured-exchange.mjs --profile profiles/requirements.json extraction.json
```

`--check-profile` judges the file against the format, with a rule and a pointer for every
problem. `--profile` validates a document against the contract and then the profile. Both
exit **4** when the profile itself is unreadable, not JSON or not a usable profile —
distinct from **1**, a document that strays from a good one.

No check can tell whether a profile is *complete*. `--describe-profile` exists for that
review: it prints every kind, every attribute with its type and whether it is required or a
list, and every enumeration value on its own line under whether it is closed or open, in the
author's order. Compare it with the source model, enumerations above all — a value the model
has and the profile lacks is a correct document refused. Decide closed or open deliberately:
a closed enumeration refuses the typo and the legitimately new value alike.

### Rules a project reviews against

A profile says which words exist. Some of a project's constraints are between words: under
ARP4754A a derived requirement does not satisfy an upstream requirement; a safety requirement
is satisfied only by safety requirements. A project writes these as **rules**, in files the
registry lists beside its profiles, each file for one registered profile:

```json
{
  "schema": "urn:structured-exchange-rules:1",
  "profile": "acme/requirements",
  "rules": [
    {
      "id": "ARP4754A-derived-no-satisfy",
      "source": "ARP4754A",
      "statement": "A derived requirement does not satisfy an upstream requirement.",
      "level": "refuse",
      "relationship": "satisfies",
      "when": { "from": { "category": ["derived"] } },
      "then": "forbidden"
    },
    {
      "id": "SAF-satisfied-by-safety",
      "source": "Safety plan",
      "statement": "A safety requirement is satisfied only by safety requirements.",
      "level": "refuse",
      "relationship": "satisfies",
      "when": { "to": { "safety": ["yes"] } },
      "then": { "from": { "safety": ["yes"] } }
    },
    {
      "id": "SAF-approved",
      "statement": "A safety requirement is approved.",
      "level": "report",
      "element": "requirement",
      "when": { "safety": ["yes"] },
      "then": { "status": ["approved"] }
    }
  ]
}
```

Rules are written, or at least validated, by people. `statement` is the rule in the project's
own words and language — French on one project, English on another — and is what every
refusal, finding and report quotes; `id` and the optional `source` say where it comes from.

**One grammar: when, then.**

- A rule applies to one `element` kind — graph elements and table rows of that kind — or to one
  `relationship` kind — graph relationships and table relations. A changed item in a proposal
  is judged with the kind and attributes the change leaves it with.
- `when` selects what the rule is about; without it, every item or link of the kind. `then`
  is what must hold for those, or `"forbidden"`: nothing selected may exist.
- A set of conditions maps an attribute name to the values it may take, and holds when every
  one of its conditions does. For a link, `from` and `to` put conditions on the source and on
  the target.

A rules file is checked against its profile whenever the registry is read. A rule naming a
kind, an attribute or a value the profile does not declare could never fire, so it makes the
registry unusable — `rules-format/undeclared-kind`, `rules-format/undeclared-attribute`,
`rules-format/undeclared-value`, `rules-format/value-type`, or
`rules-format/unsupported-attribute` for a list or a reference, which conditions do not compare — instead of
quietly checking nothing after a value was renamed. So do two files giving one rule `id`
(`registry/duplicate-rule-identifier`), a rules file for a profile the registry does not list
(`registry/rules-for-unregistered-profile`), and a listed file that is missing or outside the
project.

**Two levels.**

- `refuse`: `present_structure`, `write_structure_figure` and `write_structure_table` refuse a
  document that violates the rule, as they refuse a stray kind — with `rule/<id>`, a pointer to
  the item or link, and the statement.
- `report`: the document is accepted, and the violation is a **finding to check**: told to the
  agent, and counted in the reader's conformance statement.

**Not verifiable is not a pass.** A link rule reads the attributes at both ends. When an end is
not in the document — a `{ "ref": … }` to something it does not carry — or is carried without
the attribute the rule reads, the rule is *not verifiable here*: a finding to check, whatever
its level, never a refusal and never a silent pass. Only the items a document is about are held
to their own attributes: when a batch line names its `subjects`, a subject lacking the
attribute simply fails the condition, while the linked items carried beside it are read, not
judged.

Rules are **a review aid**. A run with no finding says that the rules somebody wrote found
nothing; it is not evidence that a specification is correct, and a finding is not a verdict —
a person decides.

### Validating a whole specification

A specification exported from a requirements tool — whole, or an extract — is checked against
the project's registry, requirement by requirement, with the reference validator:

```
node validate-structured-exchange.mjs --registry project/.pi-outpost/structured-exchange.json \
  --batch spec.jsonl --report report.json --report-markdown report.md
```

The registry is given rather than a profile, so the specification is checked by exactly what
the agent's tools read; its paths resolve against the project directory — the parent of
`.pi-outpost/`. The input is JSON Lines, in the specification's order. This batch is two lines:
SYS-1, then REQ-2 carrying the link to SYS-1 and SYS-1 itself, so the rules can read both ends:

```jsonl
{"subjects": ["sys-1"], "document": {"schema": "urn:structured-exchange:2", "kind": "table", "profile": "acme/requirements", "data": {"columns": ["id", "text"], "rows": [{"id": "sys-1", "ref": "SYS-1", "kind": "requirement", "cells": ["SYS-1", "The vehicle stops within 40 m."], "attributes": {"status": "approved", "category": "direct", "safety": "yes"}}]}}}
{"subjects": ["req-2"], "document": {"schema": "urn:structured-exchange:2", "kind": "table", "profile": "acme/requirements", "data": {"columns": ["id", "text"], "rows": [{"id": "req-2", "ref": "REQ-2", "kind": "requirement", "cells": ["REQ-2", "Brake pressure rises within 150 ms."], "attributes": {"status": "approved", "category": "derived", "safety": "yes"}}, {"id": "sys-1", "ref": "SYS-1", "kind": "requirement", "cells": ["SYS-1", "The vehicle stops within 40 m."], "attributes": {"status": "approved", "category": "direct", "safety": "yes"}}], "relations": [{"from": {"id": "req-2"}, "to": {"id": "sys-1"}, "kind": "satisfies"}]}}}
```

It exits **1**: SYS-1 conforms, and REQ-2 is non-conforming — derived, it satisfies an upstream
requirement.

**What an exporter produces.** A converter such as ISAI writes, for each requirement in order:

- a heading line, `{"heading": "1. Braking", "depth": 1}`, where a chapter starts;
- a document line: a version 2 table naming the profile (or relying on the registry's
  default), with the **same `columns` on every line**; the requirement as a row with its `id`,
  `ref`, `kind`, cells and the attributes the rules read; and its identifier in `subjects`;
- in the same table, its links as `relations`, and each requirement they reach as a row with
  the attributes the rules read. Those rows are not reported on. A link whose other end is left
  out is not verifiable, and is reported as a finding to check.

A line that is not JSON, not a valid table, has other columns, is held to no registered profile,
or reports a requirement an earlier line already reported is **unreadable**: named with its line
number, while the rest of the batch is still checked. A line with no `subjects` treats every
row as a subject. Ten thousand lines run in one process in seconds.

**The report** is itself a version 2 table, shaped like the specification: a summary chapter —
requirements per state, violations per rule counted once, unreadable lines, date, validator
version — then each chapter heading and its requirements, with the specification's columns
followed by:

- `conformity`: `non-conforming` when a `refuse` rule or the profile's vocabulary is violated
  for the requirement; otherwise `to check` when a `report` rule is violated or a rule is not
  verifiable for it; otherwise `conforms`;
- `violations`: one per line, `rule-id: statement`, with the other end of a link by its identifier (`→ sys-1`). A
  link between two requirements of the batch shows on both rows and counts once.

It carries each profile and rules file as an artifact, `rel: "checkedAgainst"` with its
`sha256` digest, so a report says exactly which rules it was checked against. A violations cell
past the contract's 1000-character bound ends with `… and N more (see the Markdown report)`; a
report past the contract's row or size bounds is not written as JSON (`reportRefused` says
why). `--report-markdown` writes the same report as Markdown — a heading per chapter, a table
of its requirements — always, and complete.

The standard output is a JSON summary. The exit status is **0** when no requirement is
non-conforming and no line is unreadable — findings to check never fail a run; **1** otherwise;
**2** when the batch cannot be read or the arguments are unusable; **4** when the registry is.

The same validator also checks a registry on its own (`--registry` alone), holds one document to
it as the agent's tools do (`--registry … doc.json`), prints every profile of a registry followed
by each rule's statement beside the conditions it checks (`--registry … --describe-profile`,
optionally with a profile identifier) so each statement can be read against what the machine
applies, and prints any valid table as the reader's Markdown export (`--markdown table.json`).

## If you are not building in this repository

You do not need our command-line interface, and you do not need this repository. The
contract ships with the package, under `contract/`:

```
node_modules/pi-outpost/dist/contract/
  schemas/structured-exchange-1.json    the normative schema — any validator runs it
  schemas/structured-exchange-2.json    the enriched contract, published beside it
  schemas/structured-exchange-rules-1.json
                                        the rules a project reviews its specifications against
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
