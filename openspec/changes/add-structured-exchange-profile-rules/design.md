## Context

See proposal.md for why. What exists and shapes the approach:

- `shared/src/structuredExchangeProfileCheck.ts` holds a document to a profile's vocabulary (`holdToProfile`),
  pure, and is called by `present_structure`, `write_structure_figure`, the conformance statement
  (`structuredConformanceFor`) and the reference validator's `--profile`.
- `server/src/structuredExchangeProfiles.ts` reads the registry and profiles from the project on every call,
  confined, and answers none / usable / unusable.
- The registry and profile formats (`urn:structured-exchange-profile-registry:1`, `…-profile:1`) have not been
  released: they can still be extended in place.
- The standalone validator (`shared/bin/validate-structured-exchange.mjs`, bundled to one file needing only
  Node) has exit codes 0–4; 4 is an unusable profile.
- A table's CSV and XLSX exports are shaped by `tableExport()` in `ui/src/presentations/tableExport.ts` —
  pure, but in the UI package, so no headless caller can reach it. Headings already travel as `section` and
  `level` columns there.
- Version 2 row roles (`added`, `changed`, `context`, `removed`) state what a producer observed in a change,
  and are coloured by the reader. They are not "this row is a linked object".
- Document ceilings: 5000 rows, 2000 relations, 1000 characters per cell.

## Goals / Non-Goals

**Goals:**
- One rule engine in `shared`, reached identically by the agent's tools, the statement and the validator.
- A reviewer runs one command over a whole specification and reads one report shaped like the specification.
- Rules are data a person can review; a rule that cannot fire because of a typo is refused when written.

**Non-Goals:**
- Changing the structured-exchange document schemas, or giving row roles a second meaning.
- Streaming reports or incremental re-validation; a batch is read whole, line by line, in one process.

## Decisions

### D1. Rules in their own files, listed by the registry, each naming its profile

```json
{
  "schema": "urn:structured-exchange-profile-registry:1",
  "profiles": ["profiles/requirements.json"],
  "rules": ["rules/arp4754a.json", "rules/safety.json"],
  "default": "acme/requirements"
}
```

The vocabulary may be rebuilt from the requirements tool; rules are written and reviewed by people. In one file,
regenerating the first would overwrite or silently misalign the second. Separate files, each re-checked against
the profile it names on every read, make a renamed value a loud refusal of the rules file instead of a rule
that quietly stops firing. Several files let a project keep a standard's rules apart from its own.

Alternatives: rules inside the profile — rejected above; rules in the server configuration — rejected, they
belong to the project and its history.

### D2. One grammar: when / then, over attribute values

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
      "statement": "Une exigence safety n'est satisfaite que par des exigences safety.",
      "level": "refuse",
      "relationship": "satisfies",
      "when": { "to": { "safety": ["yes"] } },
      "then": { "from": { "safety": ["yes"] } }
    },
    {
      "id": "CAT-derived-verification",
      "statement": "Une exigence dérivée se vérifie par analyse ou revue.",
      "level": "report",
      "element": "requirement",
      "when": { "category": ["derived"] },
      "then": { "verification": ["analysis", "review"] }
    }
  ]
}
```

- A condition is `attribute: [values]`, holding when the attribute carries one of them; a set of conditions is a
  conjunction. `when` absent or empty applies the rule to every item or relationship of its kind.
- Conditions name scalar attributes only — string, number, boolean, enumeration. Lists and references are
  refused in a rule: "any of" or "all of" a list is a choice the first rules do not need and a reviewer would
  have to be taught.
- These two forms express every rule described so far: incompatible attributes on one requirement, and link
  validity depending on the values at either end. No disjunction across attributes, no negation beyond
  choosing the allowed values, no cardinality.

Alternatives: an expression language (JSONLogic, CEL) — rejected: more to write correctly, impossible to check
against the vocabulary, and a statement a reviewer cannot line up with what is checked; separate "forbidden
combination" and "required value" forms — rejected, both are when/then.

### D3. Checked against the profile when read

A rules file is validated by its schema, then against the profile it names: kinds declared in the right
vocabulary, attributes declared by the kind and scalar, enumeration values listed, value types matching.
Rule identifiers are unique per profile across files. A failing rules file makes the registry unusable with
`rules-format/*` or `registry/*` rules, file and pointer — the same "refuse everything" as a failing profile.

### D4. Evaluation: subjects, ends, and "not verifiable"

`evaluateRules(envelope, profile, rules, subjects?)` runs after `checkAgainstProfile` passes and returns
violations and findings with the item or relationship pointer, the rule and — for a link — the other end's
identifier.

- **Subjects.** Items the document is *about*. By default every item. Batch validation states them, so linked
  objects carried for context are used by link rules but never judged by item rules or reported as rows.
  Row roles are not used for this (Context).
- **Ends.** A table relation's ends are `{ id }` (a row of the document) or `{ ref }` (outside); a graph edge's
  are element ids. An end outside the document, or a non-subject item lacking the attribute a condition on that
  end names, makes the rule **not verifiable** for that relationship — whether in `when` or `then`, since a
  selecting condition that cannot be evaluated cannot say whether the rule applies.
- **Absent attributes on a subject.** A `when` condition does not hold; a `then` condition does not hold, so a
  required value that is missing is a violation. A subject is expected to be complete.
- Results are deterministic and in document order.

### D5. Levels in the agent's tools

`refuse` violations join the profile's refusals as `rule/<id>` issues, message: statement, source, and the
other end. `report` violations and not-verifiable rules become findings in the result, listed like
open-enumeration notes, and counted in the conformance statement as `findings` beside `openValues`. The
refusal heading and the "ask, don't pick" guidance from the vocabulary rules are kept; rules are applied only
once the vocabulary conforms (`VocabularyIsCheckedBeforeRules`).

### D6. Batch validation: JSON Lines and a registry

```
validate-structured-exchange --registry path/to/project/.pi-outpost/structured-exchange.json \
  --batch spec.jsonl --report report.json --report-markdown report.md
```

Each line is `{ "heading": "1. Braking", "depth": 1 }` or `{ "document": { … }, "subjects": ["req-12"] }` (a
bare document is accepted as a document line with no stated subjects). JSON Lines keeps the export's order
explicitly, streams line by line in one process, and lets a line fail without the rest. The registry is given
rather than a profile, so the batch is checked by exactly what the agent's tools read; its paths resolve
against the project directory containing `.pi-outpost/`.

Exit status: 0 when nothing is non-conforming and no line is unreadable; 1 otherwise; 2 when the batch file
cannot be read or arguments are unusable; 4 when the registry is unusable. Findings to check do not fail a run:
this is a review aid.

### D7. The report: a version 2 table built from the batch

- Columns: the first subject document's columns, then `conformity`, `violations`. A document whose columns
  differ is reported as unreadable at its line — a report cannot align rows to two headers.
- A row per subject: its `id`, `ref`, `kind`, cells, plus the two cells. Heading lines become heading rows.
  Attributes are not copied: the report is a verdict on the specification, not a second copy of it.
- A summary chapter first: counts per state, violations per rule counted once (a link violation's identity is
  its relation `ref`, else `from`/`to`/`kind`), unreadable lines with numbers, date, validator version.
- `artifacts`: each profile and rules file used, `rel: "checkedAgainst"`, a project-relative URI and its
  `sha256` digest — the contract's existing way to bind a document to exact bytes.
- A violations cell holds each violation on its own line — `rule-id: statement (→ REQ-12)`. A cell past the
  1000-character ceiling lists what fits and `… and N more (see the Markdown report)`; the Markdown report is
  not bound by the ceiling and lists all. A report past the row or byte ceilings is not written as JSON, and the
  interface says so; the Markdown report is written regardless.
- Conformity words are English (`conforms`, `non-conforming`, `to check`); statements are the project's.

### D8. A Markdown table export in `shared`, reused by the UI

`shared/src/structuredExchangeTableMarkdown.ts` exports `tableMarkdown(rows, columns, options)`: heading rows
become `#`-headings at depth + 1 (so a document can open with its own title), rows beneath each become a GFM
table under the declared columns, a role column when the table declares roles, `|` and `\` escaped and
newlines turned into `<br>`. The row shaping now in `tableExport()` (roles, narrowing, headings) moves to
`shared` so the CSV, XLSX and Markdown exports, and the validator, read rows one way. The UI adds "download
Markdown" beside CSV and XLSX, narrowed like them.

The report's Markdown is this export applied to the report table, plus nothing report-specific: a generic
export that knows nothing of conformity is simpler to specify and serves every table.

### D9. The document shape an exporter produces

Documented for ISAI: one document per requirement — the requirement as a subject row with its attributes, its
relations, and every object those relations name as a row carrying at least the attributes the rules condition,
or as a `{ ref }` end when it cannot. A requirement's neighbours are therefore sometimes rows and sometimes
references, and the report says which rules could not be verified.

### D11. `write_structure_table`: a basic tool, the figure tool's twin

The agent writes a table as a new `.md` file with a tool of its own rather than by teaching
`write_structure_figure` a second output: a tool named for figures that writes Markdown would mislead exactly
the model it describes. It is deliberately minimal — `path` and `output_path`, no narrowing — and available in
every project, profile or not. It reuses what the figure tool already proves: confinement of `path` by
`scopeToRoot`, `assertWritableDestination` for `output_path`, `wx` so nothing is overwritten, and the project's
profile and rules held before anything is written. The Markdown is `tableMarkdown` over every row, the text the
reader downloads. It is registered wherever the figure tool is.

## Risks / Trade-offs

- [A rules file written against an old vocabulary] → refused on read (D3), naming the value; the reviewer sees it
  before any document is judged by it.
- [An exporter omits a neighbour's attribute] → the rule is "to check", not a false violation (D4); the summary's
  count of not-verifiable findings shows how much the export left out.
- [A violations cell overflows] → truncated with a count and a pointer to the Markdown report, never silently (D7).
- [A very large specification] → one process over JSON Lines; the report table may exceed ceilings, the Markdown
  does not (D6, D7). Speed is linear in lines; no model is involved.
- [Findings to check never fail a run] → intended for a review aid; a reviewer reads the summary. A later
  `--strict` could make them fail.
- [Moving `tableExport` shaping to `shared` touches the reader's existing exports] → their tests stay as they
  are and must pass unchanged; the move is behaviour-preserving.
