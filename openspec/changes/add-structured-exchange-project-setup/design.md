## Context

See proposal.md for motivation. The relevant state of the code:

- `shared/src/structuredExchangeProjectRegistry.ts` reads the registry, profiles and rules from the project's files
  on every call, and is used by both the server tools and the reference validator. It records the files it read
  (`files`, relative paths and `sha256`) but not which profile each belongs to.
- `shared/src/structuredExchangeProfileCheck.ts` holds a document to its profile item by item (`checkItem`); it
  never looks at a relationship's ends. `shared/src/structuredExchangeRuleEvaluation.ts` already resolves ends:
  it lists items with the kind and attributes a proposal leaves them (`effective`), maps relationships to their
  `{ id | ref }` ends, knows subjects, and reports what cannot be read as `not-verifiable`.
- `shared/src/structuredExchangeRulesValidation.ts` (`rulesAgainstProfile`) reads a link rule's end conditions
  against every element kind.
- `profileListing` and `rulesListing` (`shared/src/structuredExchangeProfile.ts`) are the text the validator prints
  for `--registry … --describe-profile`. `RESERVED_PROFILE_IDENTIFIERS` holds the conformity report's identifier;
  `selectProfile` leaves any reserved identifier unconstrained.
- `buildConformityReport` shows how a generated v2 table is built, bounded and recorded with artifacts.
- The reader renders any tool result whose `details` is a valid envelope (`structuredExchangePresentation.match`),
  so a new tool needs no new presentation.
- The server loads every directory under `skills/` holding a `SKILL.md` (`index.ts`, `BUNDLED_SKILLS`); the build
  copies `skills/`. `server/test/bundledSkill.test.ts` asserts exactly one skill.
- Tool lists are asserted in `server/test/sandbox-tools.test.ts` and `server/test/piOutpostTools.test.ts`.

## Goals / Non-Goals

**Goals:**
- One generator per view in `shared`, used unchanged by the tool and the validator, so the two agree byte for byte.
- End checking that reuses the rule evaluator's reading of a document rather than a second reading of relationships.
- A skill whose description and examples carry what a weak agent needs, since it may never open the body.

**Non-Goals:**
- Writing the views to files from the app: a reader already exports a table (CSV, XLSX, Markdown) and a figure.
- Rendering changes. The views are plain documents; what reads badly is a finding for the bench, not a reason
  for a bespoke view in this change.

## Decisions

### Ends are an additive field of `urn:structured-exchange-profile:1`

`relationshipKinds[]` gets its own declaration (`relationshipKindDeclaration`) with optional `from` and `to`:
arrays of element kind names, `minItems: 1`. Element kinds keep `kindDeclaration`, so `from` on an element kind
is refused by the schema.

New refusals in profile validation: `profile-format/unresolved-end-kind` (names an undeclared element kind,
listing the declared ones) and `profile-format/repeated-end-kind` (pointer to the second occurrence). Not
`uniqueItems`: a schema error points at the array, and the spec asks for the repeated name.

*Alternatives.* A new format identifier `urn:structured-exchange-profile:2`: honest about compatibility, but it
forks the registry, the validator, the docs and every example for one optional field, and old profiles would
need a migration they do not need. Rejected; the incompatibility is one-directional (a new profile on an old
reader) and documented. Declaring ends on element kinds (`outgoing: [...]`): splits one relationship's
definition across several kinds. Rejected.

### End checking lives in the profile check, fed by the rule evaluator's document reading

The reading part of `structuredExchangeRuleEvaluation.ts` (`effective`, `itemsAndRelationships`, subject
selection) moves to a small shared module both use. `checkAgainstProfile` gains a pass over relationships:

- end is an item with a kind → kind not allowed at a declared end → issue `profile/end-kind` at
  `<relationship path>/from` or `/to`, listing the allowed kinds, and marked as a vocabulary refusal so the
  "ask, do not pick" guidance is added;
- end is a `ref` not carried, or an item with no kind → a finding `profile/end-not-verifiable`;
- undeclared side → nothing.

The not-verifiable result joins the rule findings (`held.findings`), not the open-enumeration `notes`: the spec
counts it as a finding to check, the conformity report already maps findings to `to check`, and the agent's text
(`describeFindings`) already says what to do with one. Its message names the relationship kind and says the end's
kind cannot be read here.

Subjects: `checkAgainstProfile` takes the same optional subject set `evaluateRules` takes; the batch passes it.
Without one every item is a subject, so the agent's tools are unchanged in shape.

*Alternative.* Expressing ends as implicit link rules: rules condition attributes, not kinds, and ends are
vocabulary (they are refused as such, before rules run). Rejected.

### Link-rule conditions are read against declared ends

`rulesAgainstProfile` computes, per end of a link rule, the kinds to read against: the relationship kind's `from`
or `to` when declared, else every element kind. The existing `rules-format/undeclared-attribute` message names
those kinds when the end is declared. Existing rules files on profiles without ends validate exactly as before.

### Two reserved identifiers, one generator module

`urn:structured-exchange-rules-register:1` and `urn:structured-exchange-rule-patterns:1` join
`RESERVED_PROFILE_IDENTIFIERS`; nothing else changes in selection or profile validation, which already consult the
set. A new `shared/src/structuredExchangeProjectViews.ts` (exported as
`@pi-outpost/shared/structured-exchange/project-views`) exposes `rulesRegister(profile, rules, files)` and
`rulePatterns(profile, rules, files)`, each returning `{ document } | { refused: string }`, and a
`selectViewProfile(context, named?)` both callers use.

The registry reader records which files belong to which profile (the profile file and the rules files naming it),
so a view records only its own sources. URIs are the registry's relative paths, so the tool and the validator write
the same artifacts. No date or version in a view: it is reproducible, and the digests already identify the files.

Condition text comes from one formatter shared with `rulesListing`, so the register and the listing cannot read
differently.

### Rules register shape

Columns: `id`, `level`, `applies to`, `when`, `then`, `statement`, `source`, `not selected without`. A depth-1
heading `Rules of <id> — <label>` (a v2 envelope has no title of its own), then depth-2 headings, one per targeted
kind (`element kind requirement`, `relationship kind satisfies`). Rows carry `id` = the rule's identifier and
`kind` = `refuse rule` / `report rule`, so the reader colours levels apart. A profile without rules: a depth-2
heading `No rules: no rules file names this profile`. Artifacts use `rel: "generatedFrom"`.

A statement longer than a cell (1000 characters; the rules format allows 2000) makes the register refused, not
truncated: the register is the review reference, and a clipped statement would be reviewed as the rule.

### Rule patterns shape

Mocked up on the bench from the bench project's own files before this was written; a vocabulary-only graph was
mocked beside it and dropped ("B n'apporte rien, c'est vide").

- One container `rule-<n>` per rule, in the registry's order, `kind` = `refuse rule` / `report rule`, label
  `REFUSE · <id> — <statement>`. The container label ceiling is 500 characters and a statement may be 2000: the
  statement is cut with `…` in the label only, since the register holds it whole and this view is for seeing the
  shape of a rule, not for reviewing its words.
- A link rule: elements `rule-<n>-from` and `rule-<n>-to`. Label: the kinds the relationship kind allows at that
  end joined by ` | `, or `any element kind`, then ` · when <conditions>` and ` · must have <conditions>` when
  present. Kind: `must hold` when `then` conditions that end, else `selects` when `when` does, else `any`. One edge
  from source to target: kind = the relationship kind, or `<kind> (forbidden)` with label `<kind> ✗ forbidden`.
- An item rule: one element `rule-<n>-item`, label `<kind> · when … · must have …` or `… · forbidden`, kind
  `selected item` or `forbidden item`.
- Conditions: `name = v1 | v2`, sets joined by `, `.
- No viewpoints: the container kind already separates levels for the reader, and a viewpoint may not retain a
  kind the document lacks.
- A profile without rules is refused (a graph needs an element, and there is nothing to show). Past 50 rules the
  containers ceiling refuses the document; the refusal names the ceiling rather than silently drawing the first
  fifty.

### The tool: `present_project_model`

Parameters `view: "rules-register" | "rule-patterns"`, optional `profile`. Registered beside `present_structure`, which
it resembles in having no path argument: in `index.ts` as an unconfined tool under a sandbox and among the custom
tools without one, and in `piOutpostTools.ts` for a runtime child — with `projectRoot`. Read-only: no path parameters, so no confinement concern
beyond what the registry reader already enforces. Results:

- `details` = the view envelope; `content` = one line saying what was presented, then `profileListing` +
  `rulesListing`, then the request to have a person confirm each statement against its conditions;
- no registry → `isError`, naming `.pi-outpost/structured-exchange.json` and the setup skill;
- unusable → `isError`, `describeUnusableProfiles`;
- profile choice or ceiling refusal → `isError` with the reason.

**Published on demand, not always** (his request after the cost was measured: ~0.4k tokens in every request).
It joins the document extractors' mechanism in `index.ts` rather than growing a second one: withheld at bind,
published through `setToolPublished`, aged by the same idle-turn maps (1 turn unused, 5 once used), and ordered
last with the extractors so its arrival leaves a caching provider's prefix intact. The embedded session re-reads
`agent.state.tools` before every model request of a turn (`prepareNextTurnWithContext`), so a tool published from
a `tool_start` or `tool_end` event reaches the very next request — which is what lets it appear right after the
agent writes the registry. The triggers are a pure module (`server/src/projectModelTool.ts` beside the tool):

- prompt text naming `.pi-outpost/structured-exchange.json` or a path the registry lists (the listed paths are read
  from the registry file at each prompt, tolerant of a broken one, and again after a write to it);
- a `tool_start` whose `path` argument resolves to the registry, a listed file or the setup skill's `SKILL.md`, or
  whose written `content` declares `urn:structured-exchange-profile…` / `urn:structured-exchange-rules…`;
- a `tool_end` that is an error whose text says the project's registry cannot be used.

Words such as "rule" or "profile" in a prompt are deliberately not triggers: too common to be worth the tool.
The skill tells the agent to read or write the registry first, which is what brings the tool.

**The user opens the skill, not the model** (his call after the live run). With devstral-medium, asked in prose
to add an ARP4754A rule, the tool appeared right after the agent wrote the rules file and the agent called it
unprompted — about fifty times, rewriting the file between calls with invented fields (`level: "error"`, `where`,
`relationshipKind`), never opening the skill, never converging. Codestral never reached the files: it looped on
the SDK's own documentation tool. So: the guide tells the person to start with `/skill:structured-exchange-project`;
the SDK expands that command inside the session, after the server sees the prompt, so the command itself is a
publication trigger; and a refusal for a rules file that breaks the format's shape carries a rules file to copy,
because the refusal is the one text such a model reads.

*Alternative.* Published whenever the project has a registry: cheaper to write, but a project with a model still
pays the tool in every unrelated conversation, which is what he asked to avoid.

Its description is written for the agent that never opens the skill: it says to call it after every change to the
registry, a profile or a rules file, and that its errors are the files' problems to fix.

*Alternative.* A validator run through bash from the skill: the agent does not reliably know where the validator
is, and in the app the tool is the same check without a shell. Rejected for the app; kept for producers.

### Validator options

`--rules-register <file>` and `--rule-patterns <file>`, each needing `--registry`, combinable with each other. The
profile is `--describe-profile <id>` when given — beside a view it only names the profile, so stdout stays one JSON
verdict — otherwise the default, otherwise the only profile; else refused with status 2 listing profiles, like any
unusable argument. Unusable registry → status 4, nothing written. A view that does not fit the contract → status 1
and nothing written: both views are produced before either file is, so a reviewer is never handed one without
being told the other was refused. Files are written like `--report`.

### Skill and guide

`skills/structured-exchange-project/SKILL.md`: short workflow first, then the pitfalls, then complete example files
(profile with ends, rules with an item and a link rule, registry) to copy and adapt. Schema copies beside the
existing skill stay there; the new skill links to them rather than duplicating. `skills/structured-exchange/SKILL.md`
gets one pointer in "When the project holds you to a profile". The guide is `docs/structured-exchange-project-setup.md`,
for the person, from a requirements model to reviewed rules, linked both ways with the format reference in
`docs/structured-exchange.md`, which gains the ends and the two views.

## Risks / Trade-offs

- [A profile using ends makes an older pi-outpost or validator refuse the whole registry] → documented in the guide
  and the format reference, with the version that introduced ends; the refusal already names the field.
- [Every relation to an object outside a batch line becomes `to check` once its end is declared] → that is the
  "not verifiable is not a pass" rule working; the guide says to carry linked objects with their kind, as it already
  says for attributes.
- [Moving the document reading out of the rule evaluator changes a hot path for 10k-line batches] → the batch timing
  test stays; the reading is done once per document and shared by both passes.
- [Patterns for many rules become a long scroll: ten rules drew 1,100 px] → the register stays the reference for
  scanning; the patterns are for understanding one rule at a time. Measured on the bench mock-up.
- [A weak agent never opens the new skill] → the tool description carries the loop, the rules schema carries
  examples, and the one live run checks the tool is used.

## Migration Plan

Nothing to migrate: existing profiles declare no ends and behave as before; existing rules files validate as before.
A project that narrows ends sees documents refused on their next check (the agreed behaviour, as for a removed
closed-enumeration value). Rollback: remove `from`/`to` from the profile.
