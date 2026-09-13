## 1. Formats

- [x] 1.1 Write `shared/schemas/structured-exchange-rules-1.json` (D2) and add the optional `rules` list to `structured-exchange-profile-registry-1.json`, with ceilings (rules per file, conditions per set, values per condition, statement and source lengths) mirrored in a constant; verify with a schema test that the design's three example rules and example registry are accepted, that every ceiling equals the schema's bound, and that every string and array is bounded
- [x] 1.2 Add the rules types to `shared/src/structuredExchangeProfile.ts` (or a sibling module) and export them; verify `npm run typecheck` passes

## 2. Rules checked against their profile

- [x] 2.1 Implement rules-file validation (D3): schema, duplicate rule identifiers, kinds declared in the vocabulary the rule uses, attributes declared by the kind and scalar, enumeration values listed, value types matching; each refusal with a `rules-format/*` rule and pointer; verify one Node test per `RulesAreWrittenForAProfile` scenario, asserting rule and pointer
- [x] 2.2 Extend registry consistency: a rules file naming an unregistered profile, and rule identifiers repeated across files for one profile; verify Node tests at the validation level for `ARulesFileForAnUnregisteredProfileRefusesEveryDocument` and the duplicate case

## 3. Evaluating rules

- [x] 3.1 Implement `evaluateRules` (D4): item rules on subject items, link rules on graph edges and table relations with a subject end, selecting and required conditions, forbidden, absent attributes on subjects, not-verifiable ends outside the document or on non-subjects lacking the attribute; results in document order with pointer, rule and other end; verify one Node test per `ADocumentIsHeldToItsProfilesRules` scenario, every document first passing the core contract and the profile
- [x] 3.2 Make stated subjects an input of evaluation, defaulting to every item; verify a test that a non-subject neighbour is never judged by an item rule yet serves a link rule

## 4. The project registry and the agent's tools

- [x] 4.1 Read rules files listed by the registry in `server/src/structuredExchangeProfiles.ts`, confined and size-capped like profiles, validated against their profile, with every failure making the registry unusable; verify server tests for `ARulesFileInconsistentWithItsProfileRefusesEveryDocument`, `ARulesFileForAnUnregisteredProfileRefusesEveryDocument`, `RegisteredRulesApplyToTheirProfile`, `AnEditedRulesFileAppliesToTheNextCheck`, and a rules path escaping the project
- [x] 4.2 Apply rules after the vocabulary in `holdToProfile`'s callers (D5): `refuse` violations as `rule/<id>` refusals with statement, source and other end; `report` violations and not-verifiable rules as findings in the result; verify tool tests for `ARefuseRuleRefusesTheDocument`, `AReportRuleIsListedButDoesNotRefuse`, `VocabularyIsCheckedBeforeRules`, and the same refusal in `write_structure_figure` with nothing written
- [x] 4.3 Count findings in the conformance statement: `findings` in `StructuredConformance`, computed in `structuredConformanceFor`, rendered in `StructuredExchangeView.tsx` and its textual equivalent; verify the server statement test, the wire test and a UI test for `FindingsToCheckAreCounted`

## 5. Markdown export of a table

- [x] 5.1 Move the row shaping of `ui/src/presentations/tableExport.ts` (roles, narrowing, headings) to `shared` without changing its behaviour; verify the existing CSV and XLSX export tests pass unchanged
- [x] 5.2 Implement `tableMarkdown` in `shared` (D8): headings at depth + 1, one GFM table per chapter, role column when roles are declared, `|`, `\` and newlines escaped; verify Node tests for `ATableIsTakenAwayAsMarkdown`, `MarkdownEscapesWhatWouldBreakTheTable` (parsing the output back), roles and narrowing
- [x] 5.3 Add "download Markdown" beside CSV and XLSX in the table rendering, narrowed like them; verify a UI test that the downloaded text equals `tableMarkdown` for the shown rows (`MarkdownExportRunsWithoutABrowser` from the reader's side)

- [x] 5.4 Implement `write_structure_table` (D11) in `server/src/structuredExchangeTableTool.ts` and register it wherever `write_structure_figure` is (`index.ts`, `sandbox.ts`, `piOutpostTools.ts`, the context probe); verify the tool-definition, sandbox and `piOutpostTools` suites pass with the new tool listed
- [x] 5.5 Test `write_structure_table` as the agent calls it: a table written equal to `tableMarkdown`, a graph refused naming the figure tool, an existing path and a non-`.md` path refused with the file unchanged, a destination outside the writable zone and a read-only sandbox refused, a table breaking a refuse rule not written; verify one test per `TheAgentCanWriteATableToAPath` scenario with existence checks on the output path

## 6. Batch validation and the report

- [x] 6.1 Implement the batch reader (D6): JSON Lines of heading and document lines, stated subjects, bare documents, unreadable lines recorded with their number without stopping, columns mismatch reported; verify Node tests for `EachRequirementIsCheckedWithItsNeighbours` and `AnUnreadableLineDoesNotStopTheBatch`
- [x] 6.2 Build the report table (D7): columns plus `conformity` and `violations`, subject rows in input order with id/ref/kind/cells, heading rows, the summary chapter with counts, per-rule counts deduplicated by relation identity, unreadable lines, date and version, artifacts with `sha256` digests, violations cells truncated with a count past the cell ceiling; verify Node tests for every `TheConformityReportIsAStructuredExchangeTable` scenario, including that the report passes the core contract
- [x] 6.3 Render the report as Markdown with `tableMarkdown`, untruncated, whatever its size; refuse to write the JSON report past the ceilings with a message; verify tests for `AReviewerReadsTheReportAsMarkdown` and the over-ceiling case

## 7. Reference validator

- [x] 7.1 Add `--registry` (check a registry, or validate a document against it), rules in `--describe-profile` when given a registry, `--batch` with `--report` and `--report-markdown`, and `--markdown` for any valid table; exit statuses per D6, documented in the usage text; rebuild the bundle; verify tests against the bundle copied away from the repository for `ARulesFileIsCheckedAgainstItsProfile`, `ADocumentIsValidatedAgainstARegistry`, `RulesAreListedBesideTheirStatements`, `FindingsToCheckDoNotFailTheRun`, `ANonConformingRequirementFailsTheRun`, `MarkdownExportRunsWithoutABrowser`, and a ten-thousand-line batch run in one invocation (`ALargeBatchRunsInOneProcess`) with its duration recorded
- [x] 7.2 Ship the rules schema in the packaged contract and beside the skill; verify `npm run check:cli` and the skill schema copy test pass

## 8. Documentation and skill

- [x] 8.1 Document rules files, the when/then grammar, levels, not-verifiable ends, and the conformance statement's findings in `docs/structured-exchange.md`; verify every JSON example passes the documented-examples suite, extended to route rules files to their validator
- [x] 8.2 Document batch validation, the report, and the document shape an exporter such as ISAI must produce (D9), with a two-line batch example; verify the example batch runs through the bundle with the documented exit status
- [x] 8.3 Tell the agent in `skills/structured-exchange/SKILL.md`, and in `present_structure`'s refusal text, how to act on a rule refusal and on findings to check, and that a table can be written to the workspace with `write_structure_table`; verify the bundled-skill and tool tests

## 9. Verification

- [x] 9.1 Write `scenario-coverage.md` mapping every scenario of the four deltas to its test, read each cited assertion, check cited titles verbatim, and run `npm run check:scenarios`; verify every scenario is `covered`
- [x] 9.2 Run the full server and UI suites, typecheck, lint and `openspec validate add-structured-exchange-profile-rules --strict`; verify all pass
- [ ] 9.3 Rebuild `web`, `@pi-outpost/embed` and the e2e host, then drive the running widget: a table with a rule violation refused, a report finding counted in the statement, a rules file edited then the session reloaded, a conformity report opened and exported as Markdown; destructive pass — a rules file broken, deleted, pointed at another profile; verify each by reading back the DOM and files, and record what broke
