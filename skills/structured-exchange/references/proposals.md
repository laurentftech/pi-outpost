# Proposing a change to something that exists

Part of the `structured-exchange` skill. The envelope, the two identities and validation are in its `SKILL.md`.

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

Name the artifact in `target`. Then:

- An element you do not mention is left alone. Omission never removes anything.
- **On anything carrying a `ref`, the fields you declare describe what is already
  there.** They are how the reader recognises it. They change nothing.
- **To change something, say so in `set`.** That is the only thing that is applied.
- To remove something, say so in `removals`, giving both the `ref` and whether it is
  an `"element"` or a `"relationship"` — a reference alone does not say which.

> **Say what you are removing.** A removal may also carry `label`, `kind`, and for a
> relationship `from` and `to`. Add them. The reader's application holds your document
> and nothing else — it cannot look up what `REL-88` stood for, so without them the
> approval gate reads "relationship: REL-88" and asks someone to approve deleting
> something they cannot see. These fields describe and never identify: `ref` is still
> what names the thing.

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

Read that proposal:

- **The removal** names `REL-88` and says what it is: the `calls` from Ledger to
  Billing. The reader sees what goes, rather than an identifier.

- **`billing`** has a `ref` and a name, no `set` → **context**. It exists, it is shown
  so you can see where the new thing attaches, and nothing happens to it.
- **`ledger`** has a `ref`, its current name, and a `set` → **a change**. The reader
  sees `Ledger → General Ledger`, which is what makes it approvable.
- **`audit`** has no `ref` → **new**. With nothing to describe, its `label` is simply
  its value.

**Include as much context as the reader needs.** That is what the default is for: an
element you include to make the picture legible costs nothing and changes nothing.
Leaving it out to be safe is the wrong instinct — a proposal nobody can situate is a
proposal nobody should approve.

## Two rules that catch people out

**Never put a `set` on something with no `ref`.** There is nothing to change; its
fields are already its values. Refused.

**Never both `set` and remove the same `ref`.** That states two intentions at once and
is refused rather than resolved — decide which you meant.

**A relationship always declares `from` and `to`**, even when it carries a `ref`. Its
endpoints are its identity, not something you patch. To re-attach a relationship,
remove it and declare a new one.

**Moving something between containers is an ordinary change**: `"set": { "container":
"electrical" }` on an element that carries a `ref`, like any other field you change.
Containers themselves are not patched — they are declared afresh in every document.
