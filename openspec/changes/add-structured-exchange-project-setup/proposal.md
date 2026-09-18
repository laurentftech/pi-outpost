## Why

A project can now hold the agent to its data model (#208) and to review rules written on top of it (#210), but
nothing helps anyone *write* those files. The reference in `docs/structured-exchange.md` describes the formats;
the bundled skill teaches the agent to read a refusal, not to build a registry, a profile or a rules file. The
rules schema has no examples, and weak agents copy examples rather than read skills. Several mistakes pass
every check today and silently check less than their author meant: several values in one condition are an OR
and several attributes an AND; an item lacking an attribute tested in `when` escapes the rule; a link rule's
condition on `safety` also applies to a `test` if that kind declares `safety`. And once rules exist, a reviewer
has only a text listing to confirm that each statement says what its conditions check. A rule is rarely about
"requirements": it is about derived ones, safety ones — and nothing shows a reviewer which items each end of a
link rule is about.

Drawing that exposed a gap in the model itself: a profile declares relationship kinds but not which element kinds
they connect. A pattern cannot say `requirement --satisfies--> requirement` without guessing, and the tools accept
`test --satisfies--> requirement` although no project means it.

## What Changes

- **A second bundled skill for setting up a project** (`skills/structured-exchange-project/`): write a profile,
  check and list it, write rules from a fill-in example, register both, then show the rules register so a
  person confirms each statement matches its conditions. It teaches the pitfalls above, refuse versus report,
  and never inventing vocabulary. The existing `structured-exchange` skill keeps document authoring and points
  to it.
- **A guide for people setting up a project**, beside the existing format reference, and examples plus the
  missing field descriptions in the rules schema.
- **Relationship kinds may declare their ends.** A relationship kind in a profile MAY list the element kinds
  allowed at its source (`from`) and at its target (`to`). A side left undeclared allows any element kind, so
  existing profiles keep their meaning. A document held to the profile is **refused** when a relationship
  joins an item of a kind its declared ends do not allow; an end whose kind cannot be read in the document is
  a **finding to check**, never a pass. A rules file's link-rule conditions are checked against the declared
  ends, so a condition on an attribute no allowed end declares is refused when the rule is written. This is an
  additive field in the published `urn:structured-exchange-profile:1` format: a profile that uses it is
  refused by a validator or an application older than this change.
- **A generated rules register**: a version 2 table of a profile's rules, one chapter per targeted kind, with
  identifier, level, what it applies to, when, then, statement, source, and the attributes without which the
  rule does not apply or cannot be verified.
- **Generated rule patterns**: a version 2 graph with one frame per rule — its level, identifier and statement —
  holding a small drawing of what it checks: for a link rule, the source and the target typed by the kinds their
  ends allow and by the conditions that select them or that they must meet, joined by the relationship, marked
  forbidden where it is; for an item rule, the item with its conditions. A graph of the profile's vocabulary
  alone was mocked up on the bench and dropped: it said nothing a reviewer did not know.
- **Both views are generated, never drawn by the model**, and each names a profile identifier the contract
  reserves, so no project's profile holds them, as for the conformity report.
- **An agent tool presents the project model** in the app: it reads the project's registry and presents the
  rules register or the rule patterns, and gives the agent the text listing of the profile and its rules. When the
  registry is unusable it returns every issue, which makes it the agent's check while it writes the files.
- **The reference validator writes both views** from a registry, outside the application.

Out of scope:
- Cardinality rules ("every requirement has at least one verification"), text-pattern rules, and a friendlier
  rule syntax.
- Migrating documents or sessions when a profile narrows a relationship's ends: they are refused on their next
  check, as after a value is removed from a closed enumeration.
- A new profile format identifier.

## Capabilities

### New Capabilities

- `structured-exchange-project-setup`: the bundled skill for writing a project's registry, profiles and rules;
  the generated rules register and rule patterns, their reserved identifiers and their shape; the agent tool that
  presents them and reports an unusable registry; the reference validator's options that write them.

### Modified Capabilities

- `structured-exchange-profiles`: `APublishedProfileFormat` — a relationship kind may declare its ends, and a
  profile naming an undeclared element kind there is refused; `ADocumentIsHeldToItsProfile` — a relationship
  joining an item of a kind its ends do not allow is refused; `AProjectWithADefaultAdmitsNoWayAround` — two more
  reserved identifiers; `TheReaderIsToldWhetherADocumentConforms` — an end whose kind cannot be read counts as a
  finding to check; `TheReferenceValidatorChecksProfiles` — the listing shows declared ends.
- `structured-exchange-profile-rules`: `RulesAreWrittenForAProfile` — a link rule's conditions are checked
  against the element kinds its relationship's declared ends allow.
- `structured-exchange-conformity-report`: `TheConformityReportIsAStructuredExchangeTable` — a relationship end
  refused by the profile makes a row non-conforming, and an end whose kind cannot be read makes it `to check`.

## Impact

- `shared/schemas/structured-exchange-profile-1.json`, `structured-exchange-rules-1.json` — ends on relationship
  kinds; rules examples and descriptions. Copies beside the skill and in the packaged contract.
- `shared/src/` — profile validation of ends, the endpoint check in `structuredExchangeProfileCheck.ts` (reusing
  how `structuredExchangeRuleEvaluation.ts` resolves a relationship's ends), link-rule validation against ends,
  reserved identifiers in `structuredExchangeProfile.ts`, the listing, and new generators for the rules register
  and the rule patterns.
- `server/src/` — a new tool registered beside `present_structure` (`index.ts`, `piOutpostTools.ts`), with its
  tests and the tool-list tests.
- `shared/bin/validate-structured-exchange.mjs` and its bundle — options writing the two views.
- `skills/structured-exchange-project/` (new), `skills/structured-exchange/SKILL.md`, `skills/README.md`,
  `server/test/bundledSkill.test.ts` (it asserts exactly one bundled skill).
- `docs/structured-exchange.md` and a new setup guide under `docs/`.
- No change to the structured-exchange document schemas or the conformance corpus. The rendering needs no new
  presentation: the views are ordinary table and graph documents.
