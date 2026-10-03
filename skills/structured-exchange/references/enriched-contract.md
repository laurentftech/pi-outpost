# The enriched contract: `urn:structured-exchange:2`

Part of the `structured-exchange` skill. What a project's profile refuses, and what to do about it, is in its `SKILL.md`.

Everything in `SKILL.md` is version 1 and still works exactly as written. Declare version 2
instead when you need any of what follows. Nothing is removed: change the identifier and
a version 1 document is a version 2 document, except that `target` becomes an object
(`"target": { "ref": "architecture-v4" }`), which is what lets it name a revision.

**Emit version 1 unless you need something below.** The reader cannot tell which you
used and neither contract is better; there is simply no reason to reach for the larger
vocabulary to say a smaller thing.

## Attributes: the properties your domain owns

Any element, relationship or row may carry `attributes` — bounded, typed properties
whose names belong to your domain, not to this contract.

```json
{ "id": "battery", "label": "Battery", "kind": "source",
  "attributes": { "voltage": 400, "chemistry": "LFP", "serviceable": true,
                  "suppliedBy": [{ "ref": "ORG-3" }] } }
```

A value is a string, a finite number, a boolean, `null`, a reference (`{ "ref": "…" }`),
or one flat list of those. **Lists never nest and no other object shape is allowed.** A
quantity with a unit is two attributes or one string — `"mass_kg": 3.4`, not
`{ "value": 3.4, "unit": "kg" }`, which is refused.

Name the vocabulary those names come from with `profile` on the envelope:

```json
{ "schema": "urn:structured-exchange:2", "kind": "graph", "profile": "acme/electrical", "data": { … } }
```

The profile is **a name and nothing more**. It is never fetched, resolved or executed,
and a reader who does not know it still sees every attribute, rendered generically. Do
not invent one to look official; use the identifier your domain actually uses, or omit
it.

## Description, expectation, change: three different claims

Version 1 already separates *describing* a referenced thing from *changing* it. Version
2 adds a third, and confusing them is the mistake that matters:

```json
{ "id": "r1", "ref": "REQ-1",
  "label": "Stop within 40 m",
  "expect": { "revision": "rev-9", "attributes": { "status": "approved" } },
  "set": { "label": "Stop within 35 m", "attributes": { "status": "in review" },
           "removeAttributes": ["waiver"] } }
```

- **beside `ref`** — what it is called *now*. How the reader recognises it. Applied to
  nothing.
- **`expect`** — what you believe is currently true, for the receiving authority to check
  before it applies anything. You are not asserting it is true; you are saying what you
  assumed. If you did not read the current state, do not write an `expect`.
- **`set`** — the only thing that changes anything.
- **`removeAttributes`** — takes properties away. **`null` does not delete.** Writing
  `"waiver": null` sets the property to null; to unset it, name it here. Naming the same
  attribute in both `set.attributes` and `removeAttributes` is refused rather than
  resolved, because there is no precedence worth inventing.

Put the revision you prepared against on the target: `"target": { "ref": "REQ-DOC-1",
"revision": "rev-9" }`. A revision and an `expect` are only allowed in a proposal —
there is no authority to check them against otherwise.

## Locations: where it is, never what it is

```json
"locations": [{ "uri": "file:///src/brakes.ts", "revision": "abc123",
                "range": { "startLine": 10, "endLine": 42 } }]
```

A hint for a reader, zero-based. It takes no part in identity: `ref` says what something
**is**, a location says where a copy of it can be found today. Never encode a path into a
`ref` to save writing one — moving the file would then change the thing's identity.

Nothing is opened until a reader asks, and only through the application's existing rules
about what may be opened at all.

## Artifacts: linked, digested, not attached

```json
"artifacts": [{ "rel": "verifies", "uri": "https://ci.example/report.json",
                "sha256": "sha256:<64 hex characters>", "mediaType": "application/json" }]
```

The digest is mandatory, and it is the point: it binds an approval to specific bytes
even when the URI serves different ones later. If you cannot compute a digest, you do not
have an artifact link — use a location instead. Never inline the content; the envelope
carries references, and a payload pasted into it is a document nobody can read and a
ceiling you will hit.

## Tables that carry a document

A row may declare an identity and a type of its own, which is what makes a requirements
table more than a grid:

```json
{ "id": "r1", "ref": "REQ-1", "kind": "requirement",
  "cells": ["REQ-1", "Stop within 40 m", "approved"] }
```

Headings organise it, and are rows of their own — not a data row with empty cells:

```json
{ "heading": "1. Braking", "depth": 1 }
```

Traceability between rows is declared beside them, with each end stated explicitly:

```json
"relations": [
  { "from": { "id": "r1" }, "to": { "id": "r2" }, "kind": "derives" },
  { "from": { "id": "r1" }, "to": { "ref": "TEST-9" }, "kind": "verifiedBy" }
]
```

`{ "id": … }` is a row of this document and must exist — a typo is refused, not quietly
drawn pointing at nothing. `{ "ref": … }` is something outside it and is accepted as
leaving the document, which is the normal case for the test that verifies a requirement.
Relation kinds are opaque, like every other kind: `derives`, `verifiedBy`, `satisfies` —
whatever your domain says.

**Do not state coverage you have not been told.** A requirement with no relation is a
requirement with no relation; the application reports what you declared and infers
nothing about what is missing.

All of it together, as one document you can copy:

```json
{
  "schema": "urn:structured-exchange:2",
  "kind": "table",
  "profile": "acme/requirements",
  "data": {
    "columns": ["id", "requirement", "status"],
    "rows": [
      { "heading": "1. Braking", "depth": 1 },
      { "id": "r1", "ref": "REQ-1", "kind": "requirement",
        "cells": ["REQ-1", "Stop within 40 m", "approved"],
        "attributes": { "verification": "test" },
        "locations": [{ "uri": "file:///specs/brakes.md", "range": { "startLine": 10, "endLine": 12 } }] },
      { "heading": "1.1 Sensing", "depth": 2 },
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
