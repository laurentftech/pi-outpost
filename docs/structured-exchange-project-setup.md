# Setting up a project's model and rules

This page is for whoever sets up a project whose structured-exchange documents are held to a data
model and reviewed against rules — typically requirements exported from a requirements tool,
reviewed against a standard such as ARP4754A or a project's safety and verification plans. The
formats themselves are specified in [Structured exchange — for producers](structured-exchange.md#holding-documents-to-a-projects-data-model);
this page is how to get from a model and a set of review rules to files a person has confirmed.

The agent does the same work with the bundled `structured-exchange-project` skill — **open it yourself**
before you ask, by starting your message with `/skill:structured-exchange-project`. Models are not
reliable at opening a skill on their own: asked in plain words to add a rule, one was seen rewriting a
rules file fifty times with fields it invented, without ever reading the skill that shows the format.
Whether a person or the agent drafts the files, a person confirms them: rules are **a review aid**, and a rule that
silently checks less than its statement says is worse than no rule.

## What you write

Three kinds of files, in the project:

| File | Says | Example |
|---|---|---|
| a profile | the words that exist: element kinds, relationship kinds and the kinds each joins, attributes, enumeration values | `profiles/requirements.json` |
| a rules file | how those words must fit together, for one profile | `rules/review.json` |
| the registry | which profiles and rules files the project holds its documents to | `.pi-outpost/structured-exchange.json` |

## The steps

1. **Collect the source.** The requirements tool's attribute definitions and enumerations, and the
   review rules as sentences with where each comes from. Every word in the files comes from here.
2. **Write the profile** — one element kind per kind of object the export carries, its attributes
   with their exact values, and the relationship kinds with the element kinds they join.
3. **Write the registry** listing it, then **check and list** it: in the application, ask the agent to
   present the project's rules register; outside it, run the validator (below). Compare the listing
   with the source, enumeration by enumeration. Decide closed or open deliberately: a closed
   enumeration refuses the typo and the legitimately new value alike.
4. **Write the rules**, one per sentence, add the rules file to the registry, and check again. Fix
   every issue: until the files are usable, every structured-exchange document in the project is
   refused.
5. **Review each rule** in the listing and in the rule patterns: does what it selects and requires
   say what its statement says? Then have the rules confirmed by whoever owns them.

## An example to start from

The registry:

```json
{
  "schema": "urn:structured-exchange-profile-registry:1",
  "profiles": ["profiles/requirements.json"],
  "rules": ["rules/review.json"],
  "default": "acme/requirements"
}
```

The profile, `profiles/requirements.json`:

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

The rules, `rules/review.json`:

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

## From a sentence to a rule

Read the sentence for three things: **what it is about**, **what it selects**, **what it requires**.

- "A derived requirement does not satisfy an upstream requirement" is about `satisfies` links; it
  selects those whose **source** is `category: derived`; it requires that none exist:
  `"then": "forbidden"`.
- "A safety requirement is satisfied only by safety requirements" is about `satisfies` links; it
  selects those whose **target** is `safety: yes`; it requires their **source** to be `safety: yes`.
  Written the other way round — selecting safety sources, requiring safety targets — it is a
  different rule, and it validates just as well.
- "A safety requirement is approved" is about one `requirement` at a time: it selects `safety: yes`
  and requires `status: approved`.

`statement` keeps the sentence in the source's words and language: it is what every refusal,
finding and report quotes, and what the reviewer confirms the conditions against.

## What validates and still checks the wrong thing

- **Values in one condition are alternatives; conditions in one set must all hold.**
  `{"category": ["derived", "refined"]}` is derived *or* refined; `{"category": ["derived"],
  "safety": ["yes"]}` is derived *and* safety.
- **An item lacking an attribute named in `when` escapes the rule.** A requirement exported without
  `safety` is never selected by a rule reading `safety`. If a rule must reach every requirement, make
  the attribute `required` in the profile.
- **Declare relationship ends.** Without `from` and `to`, a link rule's condition on `safety` is read
  on any element kind that declares `safety`. With them, a condition on an attribute no allowed kind
  declares is refused when the rules file is read.
- **A link rule cannot read what the document does not carry.** In a batch, carry each linked
  requirement with its kind and the attributes the rules read; otherwise the rule is *not verifiable
  here* and the requirement is reported `to check`.

## Refuse or report

`refuse` stops the agent's tools from presenting a document that breaks the rule, and makes a
requirement `non-conforming` in a conformity report. `report` accepts the document and lists a
finding to check. Choose `refuse` for what the source forbids outright; `report` for what is usually
wrong but may be justified, and for a new rule being tried on real data.

## Reviewing the rules

Two generated views help the review; both are described in
[Reviewing a project's rules](structured-exchange.md#reviewing-a-projects-rules):

- the **rules register**, a table of every rule — the reference, exportable as CSV, XLSX or Markdown;
- the **rule patterns**, one small drawing per rule: for `SAF-satisfied-by-safety`, a source
  `requirement · must have safety = yes` joined by `satisfies` to a target
  `requirement · when safety = yes`. It is where a rule written the wrong way round shows.

In the application, ask the agent to present either (`present_project_model`); naming the registry or
one of its files in the request is what makes the tool available to the agent. Outside it, with the
reference validator shipped in the package:

```
node validate-structured-exchange.mjs --registry .pi-outpost/structured-exchange.json
node validate-structured-exchange.mjs --registry .pi-outpost/structured-exchange.json --describe-profile
node validate-structured-exchange.mjs --registry .pi-outpost/structured-exchange.json \
  --rules-register register.json --rule-patterns patterns.json
```

With the example above, each exits **0**. The first checks the registry with its profiles and rules
files; the second prints the profile and every rule beside the conditions it checks; the third writes
both views. A registry, profile or rules file that cannot be used exits **4**, with every issue, its
file and a pointer.

## Changing a model in use

Documents are checked against the files as they are when shown. Removing an enumeration value or
narrowing a relationship's ends makes documents presented earlier say they no longer conform; nothing
is migrated. Tell the people reading those documents before you narrow the model.

Relationship ends (`from`, `to`) are newer than the profile format's first release. A pi-outpost or a
reference validator that predates them refuses a profile using them, and with it the whole registry:
update every installation and every tool that reads the project's files — an exporter's own
validator included — before declaring ends.
