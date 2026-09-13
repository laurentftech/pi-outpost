## 1. Formats

- [ ] 1.1 Write `shared/schemas/structured-exchange-profile-1.json` and `shared/schemas/structured-exchange-profile-registry-1.json` (D1, D2), with ceilings mirrored in a `STRUCTURED_EXCHANGE_PROFILE_CEILINGS` constant; verify with a schema test that the example profile and registry in design.md are accepted and that each ceiling in the constant equals the schema's bound
- [ ] 1.2 Add the profile, registry and viewpoint-reuse types to `shared/src/structuredExchangeProfile.ts` and export them from `@pi-outpost/shared/structured-exchange/profile`; verify `npm run typecheck` passes

## 2. Profile validation (the profile itself)

- [ ] 2.1 Implement profile validation: schema, then `profile-format/*` rules for duplicate kinds and attributes, empty and repeated enumeration values, viewpoints retaining undeclared kinds, viewpoints sharing an identifier; verify a Node test per rule covers `APublishedProfileFormat` scenarios, each asserting rule and pointer
- [ ] 2.2 Implement registry validation: schema, duplicate profile identifiers across files, a default that is not registered; verify Node tests for `TwoProfilesSharingAnIdentifierRefuseEveryDocument` and `AnUnregisteredDefaultRefusesEveryDocument` at the validation level

## 3. Holding a document to a profile

- [ ] 3.1 Implement `checkAgainstProfile` for graphs and tables: kinds per vocabulary, missing kinds with heading rows exempt, undeclared attributes, types and list-ness, closed enumerations, required and null-required on complete documents, required removals in proposals; each refusal states what is allowed; verify one Node test per `ADocumentIsHeldToItsProfile` scenario, asserting rule, pointer and the listed allowed values
- [ ] 3.2 Report open-enumeration values as notes with pointer and declared values; verify `AValueOutsideAnOpenEnumerationIsAcceptedAndReported` at the check level
- [ ] 3.3 Implement profile selection: registered profile by exact identifier, default for a document naming none, `profile/unregistered-profile` and `profile/version-1-under-default` under a default, core-only without a default, sequences exempt; verify Node tests for every `AProjectWithADefaultAdmitsNoWayAround` scenario, `ASequenceIsNotHeldToAProfile`, `ProfilesAreNeverRetrieved` and `CoreValidationIgnoresRegisteredProfiles`
- [ ] 3.4 Refuse a document viewpoint whose identifier its profile also declares (`profile/viewpoint-declared-twice`); verify a Node test

## 4. The project registry on the server

- [ ] 4.1 Read `.pi-outpost/structured-exchange.json` and its profiles from the workspace root on every call, confined with `realResolve` + `isWithin`, size-capped, returning either a usable registry, an unusable one with rule, file and pointer, or none; verify server tests for `ARegistryPathLeavingTheProjectIsRefused` (including a symlink escape, skipped where symlinks are unavailable), `AMissingProfileFileRefusesEveryDocument`, `AMalformedProfileRefusesEveryDocument`, `AnEditedProfileAppliesToTheNextCheck` and `AProjectWithoutARegistryIsUnconstrained`

## 5. The agent's tools

- [ ] 5.1 Make `present_structure` per workspace (D7): take the workspace root, build it beside the figure tool in `sandbox.ts`, the unsandboxed branch of `index.ts` and `piOutpostTools.ts`, and remove the module-level singleton; verify the tool-definition and sandbox suites pass and a test asserts two workspaces with different registries get different verdicts for the same document
- [ ] 5.2 Apply the profile in `present_structure` after core validation: refusals in the existing format, success text naming the profile and listing open-enumeration notes, every document refused while the registry is unusable; update its description; verify tool tests for `AConformingDocumentIsPresented`, `AnUnusableRegistryNeverDegradesToTheCoreContract`, `CoreViolationsAreReportedFirst` and the open-enumeration report
- [ ] 5.3 Apply the profile in `write_structure_figure`, refusing a stray document or any document under an unusable registry with nothing written; verify `AStrayDocumentIsNotDrawn` with an existence check on the output path
- [ ] 5.4 Resolve viewpoints from the document, then its profile (D10): the result says where the viewpoint came from, refusals list both sets, a profile viewpoint retaining nothing present is refused; verify one tool test per `TheAgentCanWriteAFigureForAViewpoint` scenario, and the existing viewpoint tool tests still pass

## 6. The reader's statement

- [ ] 6.1 Add optional `structuredConformance` to `tool_end` and the tool chat item in `shared/src/protocol.ts`, computed where `structured` is built in `index.ts` and `convert.ts` against the registry as it is then (D8); verify server tests that a live result and a replayed result carry it, that it reads `strays` after the profile is tightened (`ARestoredDocumentIsCheckedAgainstTheProfileAsItIsNow`), `unchecked` under an unusable registry, and is absent without a registry
- [ ] 6.2 Render the statement in `StructuredExchangeView.tsx` and its accessible textual equivalent: profile, conforms / no longer conforms / could not be checked, open-value count; verify UI tests for `AConformingDocumentSaysSo`, `OpenEnumerationValuesAreCounted`, `ADocumentNotHeldToAProfileCarriesNoStatement`, and that approval hands on a byte-identical `structured` (`TheStatementDoesNotAlterTheDocument`)

## 7. Reference validator

- [ ] 7.1 Add `--check-profile`, `--profile` and `--describe-profile` to `shared/bin/validate-structured-exchange.mjs` with exit code 4 for an unusable profile, documented in its usage text; rebuild the bundle with `npm run build:validator`; verify tests run against the bundle copied to a directory with no repository access, for every `TheReferenceValidatorChecksProfiles` scenario, including a forty-value enumeration listed in full
- [ ] 7.2 Ship the profile and registry schemas in the packaged contract; verify `npm run check:cli` passes

## 8. Documentation and skill

- [ ] 8.1 Document the registry, the profile format, what is refused and reported, the default's consequences and the validator's profile options in `docs/structured-exchange.md`, and correct "will not check your profile's own rules" to be about the core; verify every JSON example in it passes the documented-examples suite
- [ ] 8.2 Add a section to `skills/structured-exchange/SKILL.md` telling the agent that a project may hold its documents to a profile, how refusals read, and what open-enumeration notes mean; copy the profile schema beside the skill's other schemas; verify the skill schema copy test passes
- [ ] 8.3 Add a section for a profile author — someone building one from DOORS or with an agent, outside this application — covering the format, `--check-profile` and `--describe-profile` for the review by hand; verify its example profile passes `--check-profile` with the bundle

## 9. Verification

- [ ] 9.1 Write `scenario-coverage.md` mapping every scenario in the three delta specs to its test, read each cited assertion, and run `npm run check:scenarios`; verify every scenario is `covered`
- [ ] 9.2 Run the full server, shared and UI suites, typecheck, lint and `openspec validate add-structured-exchange-profiles --strict`; verify all pass
- [ ] 9.3 Rebuild `web`, `@pi-outpost/embed` and the e2e host, then drive the running widget: a project with a registry, the agent presenting a conforming table, a stray one refused and corrected, an open-enumeration value, a profile tightened then the session reloaded; then a destructive pass — delete a profile file, break the registry JSON, point the default elsewhere, switch projects mid-request; verify each by reading back the DOM and the session transcript, and record what broke
