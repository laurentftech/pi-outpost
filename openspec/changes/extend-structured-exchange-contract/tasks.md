## 1. Baseline and Versioned Contract

- [x] 1.1 Confirm `add-structured-tool-results` is integrated, reconcile this change against the final version 1 schema and semantics, and freeze representative version 1 fixtures before modifying shared dispatch.
- [x] 1.2 Define explicit schema ceilings for profiles, attribute counts and values, revisions, expectations, locations, artifact links, and the complete version 2 document.
- [x] 1.3 Add the committed version 2 JSON Schema with its stable identifier, strict object shapes, typed non-recursive attribute values, object target, locations, expectations, and digest-bound artifact links, carrying forward every version 1 construct — containers, element and relationship kinds, removals, `set` patches, and table row roles.
- [x] 1.6 Extend the version 2 table shape with addressable typed rows (`id`, `ref`, `kind`, attributes, `set`), relations between rows (`from`, `to`, `kind`), and structural rows (heading, depth) exempt from column alignment.
- [x] 1.4 Generate version 2 TypeScript types from the committed schema and add drift checks proving generated declarations and every distributed schema copy match their source.
- [x] 1.5 Package both schema versions, their documentation, and their conformance data, and verify the built package from outside the repository.

## 2. Validation and Compatibility

- [x] 2.1 Add schema-identifier dispatch that selects the version 1 or version 2 validator without changing version 1 acceptance, diagnostics, rendering selection, or fallback behavior.
- [x] 2.2 Extend pre-parse and post-parse bounds enforcement to every version 2 string and collection, including finite-number and non-recursive-value checks.
- [x] 2.3 Add semantic validation for proposal-only revisions and expectations, referenced-item expectations, contradictory attribute assignment/removal, duplicate removal names, and invalid location ranges.
- [x] 2.7 Add semantic validation for rows and relations: duplicate row ids, a relation endpoint naming no declared row, a relation naming a `ref` outside the document accepted as external, and a structural row exempted from the column-alignment rule while data rows remain subject to it.
- [x] 2.8 Prove the enriched contract loses nothing: re-express each frozen version 1 fixture under the version 2 identifier and assert containers, kinds, removals, patches and row roles validate and mean the same.
- [x] 2.4 Prove validation performs no network or resource retrieval for profiles, locations, or artifact links and treats every producer-controlled identifier as inert.
- [x] 2.5 Extend validation diagnostics and accepted-size observability so a producer can identify the exact version 2 field, value, and schema or deployment limit involved. Known starting point: `data` is a `oneOf` across three variants, so a bad attribute in a table is reported as `schema/required @ /data` — the graph branch's complaint — and the producer is sent to look at the wrong thing. Discriminate on the declared `kind` before reporting.
- [x] 2.6 Add valid and invalid version 2 conformance fixtures covering every new value variant and semantic rule, while running the frozen version 1 corpus unchanged.

## 3. Producer Interface and Guidance

- [x] 3.1 Extend the standalone producer validation interface to validate version 2 from a file or stdin with the same schema, semantic rules, diagnostics, and exit statuses as the application.
- [x] 3.2 Test the packaged validator in a temporary directory without source files, `tsx`, network access, or repository-relative imports.
- [x] 3.3 Update the bundled schema documentation with complete version 2 examples for a new artifact, an unknown-profile view, and a revision-bound proposal with expectations.
- [x] 3.4 Update bundled authoring guidance to explain profile ownership, opaque references, description versus expectation versus change, explicit attribute removal, location hints, and artifact digests.
- [x] 3.5 Document that profile-specific validation and final concurrency checks belong to the producer or receiving authority and are not claims made by the core application.

## 4. Presentation and Approval

- [x] 4.1 Extend the presentation model to expose profile, target revision, descriptive attributes, expectations, proposed assignments, proposed removals, locations, and artifact links without domain interpretation.
- [x] 4.2 Render bounded attribute details generically with stable ordering and visually distinct roles for description, applicability condition, assignment, and removal.
- [x] 4.3 Present unknown profiles, locations, and artifact metadata as escaped inert text, with explicit labels explaining that expectations are checked by the receiving authority.
- [x] 4.4 Extend the accessible textual equivalent so it contains every enrichment available in the native presentation, including items whose detail panels are visually collapsed.
- [x] 4.10 Mark a proposed table from what it proposes — a referenced row carrying a change reads as changed, one with no reference as an addition, one with a reference and no change as context, and a chapter as neither — and show the target artifact with the revision it was read at. There is deliberately no approval action and no handover step in this system: approval is a person reading the screen, so the whole of the work is that what they see is derived from what would be applied.
- [x] 4.5 Preserve all version 2 fields through live transport, history restoration, approval, and recovery without normalization or replacement by a derived export.
- [x] 4.6 Keep diagram exports structural and deterministic, and prove attributes or profile text cannot inject diagram structure or change the document recovered for handover.
- [x] 4.7 Render a typed row's kind and identity, and present each row's relations in both directions with a key naming every relation kind shown; derive a traceability matrix view from the declared relations alone, reporting no judgement about missing ones.
- [x] 4.8 Render structural rows as headings spanning the table at their declared depth and position, and carry every heading, depth and position through the accessible textual equivalent, the data export, and the document a table is written into.
- [x] 4.9 Make figures and data exports treat an enriched document as they treat its version 1 equivalent, and state inside a derived view when it shows less than the document holds.

## 5. Safe Navigation and Artifact Use

- [x] 5.1 Add explicit location navigation only for schemes and workspace targets already allowed by the application's resource safety policy; leave unsupported locations visible and copyable.
- [x] 5.2 Ensure no location or artifact resource is opened, fetched, rendered, or executed before a reader action.
- [x] 5.3 For an artifact this application can reach without a new capability — one inside the workspace — read it through the confined file surface under a bounded size, compute SHA-256 before it is opened or applied, and refuse bytes whose digest does not match the validated link. An artifact addressed outward is shown and never fetched on the reader's behalf.
- [x] 5.4 Test duplicate locations, stale location revisions, unsafe schemes, missing resources, oversized resources, valid digests, and digest mismatches at the real resource boundary.

## 6. Scenario Coverage and Running-App Proof

- [ ] 6.1 Add focused schema, semantic, bounds, dispatch, packaging, producer-CLI, presentation, accessibility, navigation, and recovery tests whose assertions cover every applicable scenario in `structured-exchange-context`.
- [ ] 6.2 Build an explicit scenario-to-test matrix from `rg '^#### Scenario:' openspec/`, classifying every base and delta scenario as covered, partial, or uncovered and reading each cited assertion before accepting it as coverage.
- [ ] 6.3 Run focused tests, relevant complete suites, type checking, schema/type drift checks, package smoke tests, and strict OpenSpec validation.
- [ ] 6.4 Exercise an unknown-profile version 2 document in the running application with Playwright and verify profile, typed attributes, locations, and artifact metadata through the DOM and accessible text.
- [ ] 6.5 Exercise a revision-bound proposal in the running application with Playwright and verify descriptions, expectations, assignments, removals, approval, and byte-preserving recovery through the actual transcript and handover boundary.
- [ ] 6.8 Exercise a chaptered requirements table carrying traceability in the running application: verify headings, row kinds, both directions of each relation, the key, the derived matrix, and that the chapters and relations survive the data export and the written document.
- [ ] 6.6 Exercise explicit safe navigation and one matching and one mismatching artifact digest in the running application, verifying observable outcomes rather than relying on screenshots.
- [ ] 6.7 Run `git diff HEAD`, invoke the required `code-reviewer` agent with the complete task diff, resolve every CRITICAL/HIGH finding, and report non-blocking findings.
