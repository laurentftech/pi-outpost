## Why

A project's profile now holds the agent to its vocabulary: kinds, attributes, enumeration values. The rules a
specification is actually reviewed against go further, and they are about how values fit together. On
one requirement, some attribute values are incompatible with others. Across traceability, a link is only
valid between certain values: under ARP4754A a *derived* requirement may not `satisfy` an upstream
requirement, and a safety requirement may not be satisfied by a requirement that is not tagged safety.
Each project has its own such rules, written and validated by people — never exported from the
requirements tool — in the project's language.

Today nothing checks them, in pi-outpost or anywhere else, and a reviewer finds each violation by reading.
The same check is wanted in two places: in the agent's loop, so an extraction or a proposal that breaks a
rule is corrected before anyone sees it, and outside pi-outpost, over requirements exported from DOORS by a
separate tool (ISAI) — a whole specification or an extract — with the result handed to reviewers. For now
the result is a **review aid**, not certification evidence.

## What Changes

- **Human-written rules files, registered beside profiles.** The registry gains an optional list of rules
  files. Each file (`urn:structured-exchange-rules:1`) names the profile it applies to and holds rules in
  one declarative form, "when … then …": conditions of the form *attribute ∈ values* on a requirement
  itself, or on the source and target of a relationship of a given kind. Each rule carries an identifier,
  its source (a standard, a project convention), a statement in the project's own language, and a level:
  **refuse** or **report**. A rules file is checked against the profile's vocabulary, so a rule naming a
  value the profile does not have is refused when it is written, not discovered when it never fires.
- **Rules are applied after the profile.** A document held to a profile is checked against its vocabulary,
  then against its rules. A *refuse* rule refuses the document in the agent's tools with the rule's
  statement; a *report* rule is accepted and listed back to the agent. A link whose other end is not in the
  document, or does not carry the attribute a rule needs, is **not verifiable here** — reported, never
  silently passed and never refused.
- **The reader is told.** The conformance statement counts the findings to check, beside the values outside
  open enumerations.
- **Batch validation in the reference validator.** Given a project registry and a JSON Lines file — one
  document per requirement, with its links and the linked objects carrying the attributes the rules use,
  and the specification's headings in order — the standalone validator checks every requirement in one
  run and writes a **conformity report**. Checking requirement by requirement keeps every document small,
  whatever the size of the specification.
- **The conformity report is a structured-exchange table.** The specification's columns plus *conformity*
  (conforms, non-conforming, to check) and *violations*, the specification's chapters kept as headings, a
  summary chapter first, and the profile and rules it was checked against recorded as artifacts with
  their digests. pi-outpost renders it natively; it exports like any table.
- **Any structured-exchange table exports as Markdown**, headless: the validator writes the report as
  Markdown, and a reader can export any table as Markdown beside CSV and XLSX. Headings become Markdown
  headings with one table per chapter. The existing Markdown-to-Word export then carries it to Word.
- **The agent can write a table to the workspace as Markdown.** A basic tool, beside `write_structure_figure`
  and available in every project: `write_structure_table` reads a table document and writes a new `.md` file
  in the writable zone — the same Markdown as the reader's export. When the project holds documents to a
  profile, a table that strays from it is not written.

Out of scope, each named so it is not mistaken for forgotten:
- Converting DOORS exports. ISAI produces the documents; this change documents the shape it must produce.
- Cardinality rules ("every derived requirement has at least one justification"): on an extract an absence
  proves nothing, and none of the rules described needs them.
- Rules over requirement text (wording patterns) and rules over list or reference attributes.
- Translating the validator's own labels (conformity states, column names); rule statements are already in
  the project's language.
- Certification evidence: tool qualification, rule traceability to a standard beyond its `source` text.

## Capabilities

### New Capabilities

- `structured-exchange-profile-rules`: the rules format and its validation against a profile's vocabulary;
  how a when/then rule is evaluated on an item and on the two ends of a relationship; which items a
  document's rules apply to; what is not verifiable; the refuse and report levels in the agent's tools.
- `structured-exchange-conformity-report`: batch validation of a specification requirement by requirement
  in the reference validator; the conformity report as a structured-exchange table and as Markdown; its
  order, chapters, summary, recorded artifacts and process statuses.

### Modified Capabilities

- `structured-exchange-profiles`: `AProjectDeclaresItsProfilesLocally` — the registry may list rules
  files; `AnUnusableRegistryRefusesEverything` — a missing or malformed rules file, or one inconsistent
  with its profile, makes the registry unusable; `TheReaderIsToldWhetherADocumentConforms` — the statement
  counts findings to check; `TheReferenceValidatorChecksProfiles` — the validator checks rules files and a
  whole registry.
- `structured-exchange`: `ATableLeavesAsData` — a table also leaves as Markdown, and that export is
  available without a browser; new `TheAgentCanWriteATableToAPath` — the agent writes a table as a Markdown
  file in the workspace.

## Impact

- `shared/schemas/` — `structured-exchange-rules-1.json`; the registry schema gains `rules`; copies beside
  the skill and in the packaged contract.
- `shared/src/` — rules types, rules validation against a profile, rule evaluation (item and link, subjects,
  unverifiable), the report model, and a Markdown table export; the profile check calls rule evaluation.
- `server/src/structuredExchangeTableTool.ts` — the new `write_structure_table` tool, registered where
  `write_structure_figure` is (`index.ts`, `sandbox.ts`, `piOutpostTools.ts`).
- `server/src/structuredExchangeProfiles.ts` — reading rules files; `structuredExchangeTool.ts` and
  `structuredExchangeFigureTool.ts` — rule refusals and findings; the conformance statement's count.
- `shared/src/protocol.ts`, `ui/src/presentations/StructuredExchangeView.tsx` — the findings count in the
  statement; a Markdown export button; `ui/src/presentations/tableExport.ts` — shared row shaping.
- `shared/bin/validate-structured-exchange.mjs` and its bundle — `--check-rules`, `--registry`, `--batch`,
  `--report`, `--report-markdown`, `--markdown`.
- `docs/structured-exchange.md`, `skills/structured-exchange/SKILL.md` — rules, batch validation, the
  report, the document shape an exporter must produce.
- No change to the structured-exchange document schemas or the conformance corpus.
