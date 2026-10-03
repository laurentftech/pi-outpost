---
name: structured-exchange
description: Author a structured-exchange document — a graph, sequence, table or planning timeline the interface renders natively, such as a table of requirements with their attributes, a programme schedule with milestones and dependencies, or a proposal to change one an external authority holds — and write figures of one into a document you are authoring. Read it before calling present_structure or write_structure_figure. Use when asked to draw or diagram a structure, to present requirements or other typed items, to plan or show a schedule, roadmap or Gantt chart, to propose an evolution of an existing model, to illustrate a report you are writing, when a project's profile refuses a kind, attribute or value, or when a result would otherwise be a hand-written diagram.
allowed-tools: Bash(node:*)
license: MIT
metadata:
  version: "1.0"
---

# Authoring a structured-exchange document

Emit **data**, not a diagram. The interface renders the diagram from your data; a
diagram you draw by hand is syntax it has to guess at, and cannot be approved,
validated, or applied.

This page is what every document needs. The rest is in a `references` folder next to this
file — the path you read this page at, with `SKILL.md` replaced by `references/<name>.md`.
**Read the one for the job before writing the document**, and only that one.

| To… | Read |
| --- | --- |
| plan or show a schedule, roadmap or Gantt chart, compare two versions of a plan | `references/timelines.md` |
| propose a change to something that already exists (`target`, `ref`, `set`, `removals`) | `references/proposals.md` |
| group elements, colour a table's rows by what a change did, declare viewpoints | `references/graphs-and-tables.md` |
| carry attributes, expectations, locations, artifact links, or a requirements table with headings and traceability (version 2) | `references/enriched-contract.md` |
| put a diagram or a table into a document you are writing | `references/figures.md` |

The normative contracts sit in this directory too — `structured-exchange-1.json`,
`-2.json`, `-3.json` — read one when a detail is not enough, and do not go hunting
elsewhere in the workspace for it.

## The tool validates for you

`present_structure` checks the document before showing anything. A refusal comes back
as an error naming the rule and pointing at the offending value with a JSON Pointer.
**Read it, fix the document, call again.** That is the loop; it is not a dead end.

Nothing is repaired for you. An endpoint one character off a declared identifier is
refused, never corrected — correcting it would produce a document you did not write.

## The envelope

```json
{
  "schema": "urn:structured-exchange:1",
  "kind": "graph",
  "data": { "nodes": [...], "edges": [...] }
}
```

`kind` is `graph`, `sequence`, or `table` — and, under version 3, `timeline`. Under
version 1 a table is a projection: it can be shown and reasoned about, never proposed.
Under version 2 its rows can carry an identity, so a table can be proposed like
anything else (`references/enriched-contract.md`).

Each carries its own `data`:

```jsonc
// graph — things and directed relationships between them
"data": { "nodes": [{ "id": "a", "label": "A" }],
          "edges": [{ "from": "a", "to": "b", "kind": "calls" }] }

// sequence — participants and ordered messages between them
"data": { "participants": [{ "id": "a", "label": "Client" }],
          "messages": [{ "from": "a", "to": "b", "label": "POST /orders" }] }

// table — columns and rows aligned to them
"data": { "columns": ["requirement", "satisfied by"],
          "rows": [["REQ-1", "Billing"]] }
```

A message declares a `label` and no `kind` — the label *is* what is being sent.
Message order is the order you write them in; nothing sorts them for you.

A timeline is version 3 and a whole envelope of its own. Start from this one — it holds
what most plans need:

```json
{
  "schema": "urn:structured-exchange:3",
  "kind": "timeline",
  "data": {
    "title": "Bench test campaign",
    "time": { "start": "2027-03-01", "end": "2027-05-31", "scale": "week" },
    "rows": [
      { "type": "separator", "label": "Bench" },
      { "type": "task", "id": "T1", "label": "Bench setup", "items": [
        { "type": "activity", "id": "setup", "start": "2027-03-01", "end": "2027-03-19", "label": "Install and calibrate" }
      ] },
      { "type": "task", "id": "T2", "label": "Test runs", "items": [
        { "type": "milestone", "id": "trr", "date": "2027-03-22", "kind": "TRR", "label": "Test Readiness Review" },
        { "type": "activity", "id": "runs", "start": "2027-03-23", "end": "2027-05-14", "label": "Campaign" }
      ] }
    ],
    "dependencies": [{ "from": "setup", "to": "trr" }, { "from": "trr", "to": "runs" }],
    "periods": [{ "start": "2027-03-29", "end": "2027-04-02", "label": "Easter closure", "kind": "closure" }],
    "references": [{ "date": "2027-05-28", "label": "Contractual delivery" }]
  }
}
```

- `scale` is `week` for a few months, `month` for a year or two, `quarter` beyond.
- A closure or a holiday is a **period**, never an activity: it belongs to no task.
- Every item falls inside `time`; a milestone is one `date`; give an item an `id` if
  anything depends on it.

Read `references/timelines.md` for the rest: dependency types, comparing two versions of
a plan, and putting a timeline in a report.

A table of requirements with headings, typed rows and traceability is version 2 — start from
this one, and read `references/enriched-contract.md` for attributes, expectations and links:

```json
{
  "schema": "urn:structured-exchange:2",
  "kind": "table",
  "data": {
    "columns": ["id", "requirement", "status"],
    "rows": [
      { "heading": "1. Braking", "depth": 1 },
      { "id": "r1", "ref": "REQ-1", "kind": "requirement",
        "cells": ["REQ-1", "Stop within 40 m", "approved"],
        "attributes": { "verification": "test" } },
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

## Two identities, never confused

Every element carries an `id`, and may carry a `ref`.

- **`id`** is local to your document. Relationships point at it. It means nothing
  outside the document you are writing, so make it readable — `payment-service`,
  not `n1`.
- **`ref`** is the identifier the external authority already holds for that element.
  Use it only when you know it, from something that was given to you. **Never invent
  one.** An element with no `ref` is understood as new.

Give a referenced element its **current** label whenever you know it. Without one the
reader sees the bare reference — `EL-12` instead of `Billing` — which is exactly the
context they needed and did not get.

## Describing something new

Leave `target` out. Every element declares its `label`; every relationship declares
its `kind`.

> **Type your elements.** `kind` is optional on an element and you should almost
> always set it. The reader's view colours by it and builds a key from it, so a
> diagram whose elements carry no type arrives in a single flat grey — legible, and
> much harder to read than it needed to be.

```json
{
  "schema": "urn:structured-exchange:1",
  "kind": "graph",
  "data": {
    "nodes": [
      { "id": "gateway", "label": "API Gateway", "kind": "service" },
      { "id": "billing", "label": "Billing", "kind": "service" },
      { "id": "ledger", "label": "Ledger", "kind": "datastore" }
    ],
    "edges": [
      { "from": "gateway", "to": "billing", "kind": "calls" },
      { "from": "billing", "to": "ledger", "kind": "writes" }
    ]
  }
}
```

`kind` is an opaque string from your domain, on elements and relationships alike.
Nothing validates it against a list and nothing interprets it: it is shown, it tells
two otherwise identical things apart, and whatever applies the document is free to
map it onto its own type system.

Pick the vocabulary the domain already uses, and use it consistently — the same
concept must get the same string throughout a document, because that string is what
groups things in the key. Two or three types for a small diagram, rarely more than
about eight; past that the key stops helping.

A physical architecture might use `battery`, `converter`, `motor`, `controller`,
`sensor`; a software one `service`, `datastore`, `queue`, `external`; a stereotyped
model whatever its profile defines. Relationships likewise: `power`, `thermal`,
`communication` on a physical model, `calls`, `writes`, `publishes` on a software one.

## Changing something that exists

> **The one rule that trips everyone up.** When you propose a change to something
> that already exists, the fields you write beside its `ref` say *what it is called
> now*. They are not applied. The new value goes in `set`.
>
> ```json
> { "id": "ledger", "ref": "EL-7", "label": "Ledger",
>   "set": { "label": "General Ledger" } }
> ```
>
> Writing `"label": "General Ledger"` on its own does **not** rename anything — it
> claims that is already its name, and the proposal silently does nothing. If the
> tool answers `0 changed`, this is what happened.

A whole proposal — one element kept as context, one renamed, one added, one relationship
removed and said what it was:

```json
{
  "schema": "urn:structured-exchange:1",
  "kind": "graph",
  "target": "architecture-v4",
  "removals": [
    { "type": "relationship", "ref": "REL-88",
      "kind": "calls", "from": "ledger", "to": "billing" }
  ],
  "data": {
    "nodes": [
      { "id": "billing", "ref": "EL-12", "label": "Billing" },
      { "id": "ledger", "ref": "EL-7", "label": "Ledger",
        "set": { "label": "General Ledger" } },
      { "id": "audit", "label": "Audit" }
    ],
    "edges": [{ "from": "audit", "to": "billing", "kind": "calls" }]
  }
}
```

An element you do not mention is left alone; never put a `set` on something with no
`ref`. Read `references/proposals.md` for the rest of the rules that refuse a proposal.

## When the project holds you to a profile

A project may register profiles — its own data model: the kinds that exist, the attributes
each kind carries, the values each enumeration allows, the kinds each relationship joins.
Writing or changing the registry, a profile or a rules file is another job: read the
`structured-exchange-project` skill for it. Then `present_structure` and
`write_structure_figure` refuse a document that strays from its profile, exactly as they
refuse one that breaks the contract, and the refusal says **what the profile allows** at the
place it points. Act on it:

- **Use the words the refusal lists.** A kind, an attribute name or an enumeration value
  outside the profile is refused, and a near-miss is not corrected for you. So is a
  relationship between kinds its ends do not allow (`profile/end-kind`): do not retype an item
  to make a link pass. Never invent a
  value to make a document pass; if none of the allowed values is true, say so to the user.
- **Tell the two refusals apart.** A refusal headed "by the structured-exchange contract itself" is about
  the document's shape — rows, endpoints, fields — and says nothing about the profile, which is only
  applied once the contract is satisfied. Fix the shape; do not go looking for a stricter profile.
- **Omitting `profile` does not step around it.** When the project declares a default, a
  document naming no profile is held to the default; naming a profile the project does not
  register, or writing version 1, is refused.
- **In a proposal**, a changed item still states its `kind` so its attributes can be
  checked; an item you add (no `ref`) carries every required attribute; you cannot remove a
  required attribute, and `null` is not a value for one.
- **Values outside an open enumeration are accepted** and listed back to you with the values
  the enumeration declares. Look at each: a new value you meant is fine; a typo is not —
  present the document again, corrected.
- **A `rule/…` refusal quotes a rule the project wrote** — for example that a derived
  requirement does not satisfy an upstream one. If your document says what your source says,
  the source breaks the rule: do not change a link or a value just to make it pass. Tell the
  user which item and which rule, and let them decide.
- **Findings to check come back with an accepted document**: a `report` rule was violated, or
  a rule is not verifiable because a linked item is missing from the document or lacks the
  attribute the rule reads, or a relationship's end is not in the document so its kind cannot
  be checked (`profile/end-not-verifiable`). Tell the user about each. If you have the linked item, add it with
  its attributes and present again; never invent a value to clear a finding.
- **"The project's profile registry cannot be used"** is not about your document. Nothing
  can be presented until the project's files are fixed: tell the user which file and rule,
  rather than reshaping the document around it.

A profile may declare **viewpoints** too. `write_structure_figure` accepts one by its `id`
even when the document does not declare it, and its result says whether the viewpoint came
from the document or from the profile.

## What the reader sees, and what the model sees

The structured document is rendered for the human and **does not reach the model** —
not even yours, on a later turn. So the result's ordinary text must stand on its own:
summarise what the structure says, well enough that the next question can be answered
without it. A document with a rich diagram and a one-line text is a document you
cannot reason about afterwards.

You also do not choose how a graph is arranged. It is laid out across the page while it
fits the reading column and down the page when it does not, and the reader can turn it
either way. Do not describe a diagram's direction in your summary — say what it shows, not
which way it runs.

## Size

Collections and strings are bounded — 500 elements, 2000 relationships, 500-character
labels, among others; the schema states them all. Version 2 bounds its own additions the
same way: 50 attributes per item, 1000-character values, 10 locations, 20 artifact links,
2000 relations, headings six deep. Exceeding a bound is refused with a diagnostic naming
the exact field and the limit it passed.

If you are near a limit, the question was too broad. Narrow the scope rather than
trimming the answer: a diagram of everything is one nobody can read, and a proposal
nobody can read is one nobody should approve.
