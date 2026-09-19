---
name: structured-exchange-project
description: Set up the model and the review rules a project holds its structured-exchange documents to — the registry (.pi-outpost/structured-exchange.json), its profiles (kinds, attributes, enumerations, which kinds a relationship joins) and its rules files. Read it before writing or changing any of those files, and when the project's structured-exchange registry cannot be used. Use when asked to build a profile from a requirements tool's export or a data model, to turn review rules from a standard or a plan into rules files, or to show a project's rules for review with present_project_model.
license: MIT
metadata:
  version: "1.0"
---

# Setting up a project's model and rules

A project writes three kinds of files, and people review them:

- a **profile** — the words that exist: element kinds, relationship kinds and the kinds each
  relationship joins, the attributes of each kind, the values of each enumeration;
- a **rules file** — how those words must fit together: "a derived requirement does not
  satisfy an upstream requirement";
- the **registry**, `.pi-outpost/structured-exchange.json` at the project root, listing both.

You draft them. A person confirms them. Every document the agent presents in this project is
then held to them — so a wrong file does not look wrong: it refuses good documents, or
checks less than anyone meant.

## The loop

1. **Start from the source.** A requirements tool's export, a data model, a standard, a
   safety plan the user gave you. Every kind, attribute, value and rule comes from it. Never
   invent one to fill a gap: ask the user.
2. **Write the profile, then the registry listing it.** Call `present_project_model` with
   `view: "rules-register"`. Its result lists the whole profile as text: compare it with the
   source, value by value. The tool is offered only once the conversation touches the model:
   if you do not see it, read `.pi-outpost/structured-exchange.json` (or write it) first.
3. **Write the rules**, one rule per sentence of the source, starting from the example below.
   Add the rules file to the registry's `rules` and call `present_project_model` again.
4. **Fix what it returns.** An error result means the files are unusable — and while they
   are, every structured-exchange document in the project is refused. Each issue names the
   file, the rule and a pointer (see [What the check says](#what-the-check-says)). Fix and
   call again until it presents.
5. **Read the listing it returns.** For each rule: do its conditions say what its statement
   says? Check against [What passes silently](#what-passes-silently).
6. **Show the user.** Call it with `view: "rule-patterns"` — one small drawing per rule, what
   it selects and what it requires — and ask them to confirm each rule. Rules are written, or
   at least validated, by people; say so rather than presenting your draft as settled.

Never write or draw the register or the patterns yourself: only the tool's are generated from
the files.

Outside this application, the reference validator does the same checks:
`--check-profile profile.json`, `--registry .pi-outpost/structured-exchange.json` (checks it
all), `--registry … --describe-profile` (the listing), and `--registry … --rules-register
register.json --rule-patterns patterns.json` (the two views).

## The files

The registry. Paths are relative to the project and must stay inside it; `rules` and
`default` are optional. With a `default`, every document is held to that profile.

```json
{
  "schema": "urn:structured-exchange-profile-registry:1",
  "profiles": ["profiles/requirements.json"],
  "rules": ["rules/review.json"],
  "default": "acme/requirements"
}
```

A profile. Enumerations list their values in the order a reviewer reads them, and say whether
they are `closed` (anything else is refused) or open (anything else is accepted and reported).
A relationship kind may say which element kinds it joins: `from` at its source, `to` at its
target. Declare them whenever the source model says so — a side left out allows any kind.

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
        { "name": "category", "type": "enumeration", "values": ["derived", "refined", "direct"], "closed": true },
        { "name": "safety", "type": "enumeration", "values": ["yes", "no"], "closed": true }
      ]
    },
    {
      "kind": "test",
      "attributes": [{ "name": "bench", "type": "enumeration", "values": ["hil", "vehicle", "simulation"], "closed": true }]
    }
  ],
  "relationshipKinds": [
    { "kind": "satisfies", "from": ["requirement"], "to": ["requirement"] },
    { "kind": "verifies", "from": ["test"], "to": ["requirement"] }
  ]
}
```

A rules file, for one registered profile. `statement` is the rule in the source's own words
and language: it is what every refusal and report quotes. `id` and `source` say where it
comes from.

```json
{
  "schema": "urn:structured-exchange-rules:1",
  "profile": "acme/requirements",
  "rules": [
    {
      "id": "ARP4754A-derived-no-satisfy",
      "source": "ARP4754A",
      "statement": "Une exigence dérivée ne satisfait pas une exigence amont.",
      "level": "refuse",
      "relationship": "satisfies",
      "when": { "from": { "category": ["derived"] } },
      "then": "forbidden"
    },
    {
      "id": "SAF-satisfied-by-safety",
      "source": "Safety plan",
      "statement": "Une exigence safety n'est satisfaite que par des exigences safety.",
      "level": "refuse",
      "relationship": "satisfies",
      "when": { "to": { "safety": ["yes"] } },
      "then": { "from": { "safety": ["yes"] } }
    },
    {
      "id": "VER-safety-on-hil",
      "source": "Verification plan",
      "statement": "Une exigence safety est vérifiée sur banc HIL.",
      "level": "report",
      "relationship": "verifies",
      "when": { "to": { "safety": ["yes"] } },
      "then": { "from": { "bench": ["hil"] } }
    },
    {
      "id": "SAF-approved",
      "source": "Safety plan",
      "statement": "A safety requirement is approved.",
      "level": "report",
      "element": "requirement",
      "when": { "safety": ["yes"] },
      "then": { "status": ["approved"] }
    }
  ]
}
```

## Writing a rule

- **Item or link.** A rule about one thing names `element` (a kind of element or table row).
  A rule about a link names `relationship`, and conditions its source under `from` and its
  target under `to`.
- **`when` selects, `then` requires.** `when` says which items or links the rule is about;
  without it, all of that kind. `then` says what those must have — or is `"forbidden"`:
  nothing selected may exist.
- **Translate the sentence, do not improve it.** "A safety requirement is satisfied only by
  safety requirements" selects links whose *target* is safety, and requires their *source* to
  be. Writing it the other way round is a different rule that also validates.

## What passes silently

Each of these validates, and checks something other than what the statement says.

- **Values in one condition are alternatives; conditions in one set must all hold.**
  `{ "category": ["derived", "refined"] }` selects derived *or* refined.
  `{ "category": ["derived"], "safety": ["yes"] }` selects what is derived *and* safety. There
  is no way to require two values of one attribute at once, because an attribute holds one.
- **An item lacking an attribute named in `when` is not selected, and escapes the rule.** A
  requirement exported without `safety` is never checked by a rule whose `when` reads
  `safety`. If the rule must reach every requirement, make the attribute `required` in the
  profile, or ask the user whether a missing value should be written as a value.
- **A link rule reads its conditions on the kinds the relationship allows at that end.**
  Without declared ends, `from: { "safety": ["yes"] }` is read on *any* kind that declares
  `safety` — a `test` too, if it has one. Declare `from` and `to` on the relationship kind.
- **`from` and `to` belong to link rules only.** An item rule's `when` and `then` are flat
  attribute conditions.
- **An attribute holding a list or a reference cannot be conditioned**, and is refused.
- **What a rule cannot read is not a pass.** When a link's other end is not in the document,
  or is carried without the attribute the rule reads, the rule is *not verifiable here*: a
  finding to check, never a silent pass and never a refusal.

## Refuse or report

- **`refuse`** stops the agent's tools from presenting a document that breaks the rule. Use it
  for what is never acceptable in the source's own terms — a prohibition in a standard.
- **`report`** accepts the document and lists the violation as a finding for a person to
  check. Use it for what is usually wrong but may be justified, or while a new rule is being
  tried on real data.

When the source does not say, ask the user; do not choose `refuse` to look strict.

## What the check says

| Rule in the issue | What it means | What to do |
|---|---|---|
| `rules-format/undeclared-value` | a condition names a value the enumeration does not list | use the profile's value exactly, or ask whether the profile is missing it |
| `rules-format/undeclared-attribute` | the kind — or no kind allowed at that end — declares the attribute | check the kind and the ends; never add the attribute to the profile to make a rule pass |
| `rules-format/undeclared-kind` | the rule names a kind the profile does not have | use the profile's kind; mind element versus relationship |
| `rules-format/unsupported-attribute` | the attribute holds a list or a reference | a rule cannot condition it; tell the user |
| `rules-format/value-type` | a value's type differs from the attribute's | write a number as a number, a boolean as a boolean |
| `profile-format/unresolved-end-kind` | `from` or `to` names an element kind the profile does not declare | fix the name; ends name element kinds, not relationships |
| `registry/duplicate-rule-identifier` | two rules of one profile share an `id` | give each rule its own identifier |
| `registry/rules-for-unregistered-profile` | a rules file names a profile the registry does not list | fix the rules file's `profile`, or register the profile |
| `registry/missing-…`, `…/outside-project` | a listed file is missing or outside the project | fix the path in the registry |

## Changing a model that is in use

Every document is checked against the files as they are on disk when it is shown. Narrowing a
profile — a value removed from a closed enumeration, an end restricted — makes documents
presented earlier say they no longer conform. Tell the user before you narrow anything.

Declaring `from` or `to` on a relationship kind is newer than the profile format's first
release: a pi-outpost or a validator older than that refuses a profile using them. If the
project's files are also read by another tool or an older installation, say so to the user.

For authoring the documents themselves — and acting on a refusal while presenting one — read
the `structured-exchange` skill.
