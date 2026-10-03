# Graphs and tables: roles, containers, viewpoints

Part of the `structured-exchange` skill. The envelope and validation are in its `SKILL.md`.

## Roles on a table's rows

A table cannot be proposed, but it can *report* on a change it projects. Any row
may say what it plays, and the interface colours it the way it colours an added or
changed element in a graph:

```jsonc
"data": {
  "columns": ["id", "requirement", "status"],
  "rows": [
    { "role": "added",   "cells": ["REQ-5", "Log every actuation.", "draft"] },
    { "role": "changed", "cells": ["REQ-2", "Signal a fault within 200 ms.", "in review"] },
    { "role": "removed", "cells": ["REQ-3", "Read battery voltage at 10 Hz.", "withdrawn"] },
    { "cells": ["REQ-1", "Stop the vehicle within 40 m.", "approved"] }   // context
  ]
}
```

`role` is one of `added`, `changed`, `context`, `removed`. A row that declares none
reads as context when any other row declares one. Both row forms are accepted, so
`["REQ-1", "…"]` and `{ "cells": ["REQ-1", "…"] }` are the same row, and a table
that declares no role anywhere is rendered exactly as before roles existed.

Declare the role — do not put it in a column and expect the colours. A `status`
column is your data and is rendered as data; nothing infers a role from it.

## Grouping: containers

A graph or a sequence may declare **containers** — subsystems, layers, teams,
whatever the domain groups things into — and each element or participant may say
which one it belongs to.

```jsonc
"data": {
  "containers": [{ "id": "electrical", "label": "Electrical system" }],
  "nodes": [{ "id": "battery", "label": "Battery", "container": "electrical" },
            { "id": "driver",  "label": "Driver" }],          // in no container
  "edges": [{ "from": "driver", "to": "battery", "kind": "operates" }]
}
```

Four things to know:

- **Membership goes on the member**, never as a list of members on the container.
  An element belongs to one container or to none.
- **Relationships ignore grouping entirely.** They connect elements, they cross
  container boundaries freely, and an endpoint is never a container id. Naming a
  container as `from` or `to` is refused.
- **Containers do not nest.** A member names a container, never a chain of them.
- **A container nobody joins is fine.** Declare the group first and fill it later
  if that is what you mean; it is drawn as an empty box.

Naming a container the document does not declare is refused rather than quietly
ungrouped — an element shown outside a group it belongs to would misstate the
system you are describing.

In a sequence, the view puts a container's columns next to each other so its
header spans them. If you interleave two containers, the columns are reordered:
the first member of a container met brings the rest of that container with it,
and anything belonging to no container keeps its place. Declare participants in
the order you want them read.

## Viewpoints: the readings a graph is made for

When a graph will be read in more than one way — power, then control, then what is
safety-relevant — declare those readings as `viewpoints` on the envelope, rather than
leaving the reader to rebuild each one from the key:

```json
{
  "schema": "urn:structured-exchange:2",
  "kind": "graph",
  "viewpoints": [
    {
      "id": "power",
      "label": "Power distribution",
      "concern": "Where energy is stored, converted and consumed",
      "elementKinds": ["source", "load"],
      "relationshipKinds": ["power"]
    }
  ],
  "data": {
    "nodes": [
      { "id": "battery", "label": "Battery", "kind": "source" },
      { "id": "motor", "label": "Motor", "kind": "load" },
      { "id": "ecu", "label": "ECU", "kind": "controller" }
    ],
    "edges": [
      { "from": "battery", "to": "motor", "kind": "power" },
      { "from": "ecu", "to": "motor", "kind": "signal" }
    ]
  }
}
```

- **A viewpoint says what it retains.** Name the element kinds, the relationship kinds,
  or both — at least one list. A list you leave out keeps that whole vocabulary.
- **Only kinds the document has.** Every kind you retain must be the kind of some
  element (or, for `relationshipKinds`, some relationship) in this document. A typo is
  refused, not corrected, and the refusal says when the word exists in the other list.
- **Always give the concern.** It is printed inside every figure drawn for the
  viewpoint — write it as the question that reading answers.
- **Graphs only**, and at most twenty per document.
- **Something with no kind survives every viewpoint.** If an element must drop out of a
  reading, give it a kind.

When you write a report with one chapter per reading, write one figure per viewpoint:
`write_structure_figure` with `viewpoint: "power"`. Do not rebuild the same selection
from hide lists — the viewpoint carries both the selection and the reason for it.
