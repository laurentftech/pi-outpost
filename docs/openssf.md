# OpenSSF: status and plan

pi-outpost holds the OpenSSF Best Practices **passing** badge
([project 16423](https://www.bestpractices.dev/en/projects/16423)). This page records where the
project stands against the **silver** and **gold** levels and the separate **Security Baseline**
levels 1–3, what it intends to do about each gap, and what has changed. It is kept up to date as
work lands, and read before every update of the badge entry.

It proposes work; it does not claim it done. An action is **Done** only once its evidence is
public, and the badge entry is changed only after that. Best Practices passing, silver and gold
and Security Baseline levels 1–3 are separate series; achieving one does not imply the other. Best Practices criteria:
[silver](https://www.bestpractices.dev/en/criteria/1), [gold](https://www.bestpractices.dev/en/criteria/2).

Status values: **To do** · **In progress** (pull request open) · **Done** (public evidence) ·
**Maintainer decision** (a commitment only the maintainer can make).

The [product roadmap](roadmap.md) describes the individual maintainer's direction through 2027,
including priorities and exclusions, without delivery commitments. This page tracks the evidence
and remaining work for OpenSSF criteria.

## Current standing

As of 8 November 2026: passing 100%, silver 67%, gold 39% (entry last updated on 7 November). OpenSSF Scorecard: 7.3, from a scan run on 8 November before v0.61.0 was published. The public entry lists every answer
and its justification. Supporting evidence for the checks this repository runs is in
[Code quality and verification](quality.md).

The Security Baseline entry was audited and saved on **8 November 2026**, against criteria
**v2026.08.28**. All 64 controls have a recorded answer and justification; none is unknown.

[![OpenSSF Baseline](https://www.bestpractices.dev/projects/16423/baseline)](https://www.bestpractices.dev/en/projects/16423/baseline-1)

| Security Baseline level | Met | N/A | Unmet | Site progress | Status |
| --- | ---: | ---: | ---: | ---: | --- |
| [Level 1](https://www.bestpractices.dev/en/projects/16423/baseline-1) | 23 | 1 | 0 | 24/24 (100%) | Achieved |
| [Level 2](https://www.bestpractices.dev/en/projects/16423/baseline-2) | 15 | 0 | 4 | 15/19 (79%) | Not achieved |
| [Level 3](https://www.bestpractices.dev/en/projects/16423/baseline-3) | 10 | 1 | 10 | 11/21 (52%) | Not achieved |

These are the controls specific to each level, not cumulative totals. Site progress counts both
Met and N/A; higher levels also require the preceding levels. The badge is a voluntary
self-assessment with public justifications, not an independent security certification.

Evidence checked for this update:

- All 2,804 tracked files were inventoried by content, including extensionless files and Office
  container entries. No native executable artifacts were found. Document fixtures have reviewable
  XML, generators or recorded Office provenance; graphical assets are excluded by the criterion.
- All 11 workspaces, the MCP bundles and container builds use this source repository. The two
  multi-repository controls are N/A.
- GitHub Actions defaults to read-only permissions. The active `protect_main` ruleset requires
  pull requests, CI and CodeQL, with no bypass; independent human approval is not required.
- All five software files attached to v0.61.0 passed Sigstore verification constrained to
  `.github/workflows/release.yml`, `refs/tags/v0.61.0` and GitHub-hosted runners. An altered bundle
  was refused. This verifies provenance, not OS code signing or reproducible builds.
- Existing architecture, sandbox investigations and OpenSpec design risk analyses support the
  Baseline security-assessment and threat-modeling controls. The stronger consolidated security
  argument and independent review work below remain open.

## Security Baseline — remaining work

Each row corresponds to an Unmet answer saved on the public entry. Completion means the change
and its evidence are public, the relevant enforcement has been checked, and the answer has been
updated. The Level 2 work comes first; Level 3 also depends on it.

### Level 2

| Criterion | Observed gap | Completion evidence | Status |
| --- | --- | --- | --- |
| `OSPS-LE-01.01` | MIT licensing does not require a legal authorization assertion on every commit; there is no mandatory DCO/CLA check. | Adopt a per-commit attestation process, document it in CONTRIBUTING, and require a check that accepts valid assertions and refuses missing ones. | Maintainer decision |
| `OSPS-QA-06.01` | Documentation-only PRs can merge without running a test suite. Tests on main run after acceptance. | Run an appropriate automated test suite before every merge, including documentation-only changes, and require its result through `CI ok`. | To do |
| `OSPS-SA-02.01` | The HTTP route inventory includes `/files/download`, absent from the reference documentation; the WebSocket protocol lacks a complete external message reference. | Document inputs, outputs, authentication and errors for the actual HTTP/WebSocket inventory; check it against production routes and protocol types. Keep the existing CLI, embedding, MCP and OpenAPI references aligned. | To do |
| `OSPS-VM-01.01` | SECURITY.md describes coordinated disclosure but explicitly promises no response timeframe. | Publish a realistic response/acknowledgement target and escalation process. Distinguish that target from a universal fix deadline. | Maintainer decision |

### Level 3

| Criterion | Observed gap | Completion evidence | Status |
| --- | --- | --- | --- |
| `OSPS-AC-04.02` | CodeQL requests `packages: read` for private packs and `actions: read` for private repositories, although this public configuration uses neither. | Remove unused scopes or document a concrete requirement; verify the real analysis still uploads results. Review each privileged job against its activity. | To do |
| `OSPS-BR-01.04` | The scenario-coverage step interpolates a collaborator-controlled base ref into a shell script. | Pass it through a quoted environment variable and validate its use; exercise unusual valid refs. Apply the same review to other trusted inputs. | To do |
| `OSPS-BR-07.02` | Credential hygiene and deployment-key rotation are documented, but no policy covers storage, access and rotation of the project's own development/CI/publication credentials. | Publish that policy, including OIDC, remaining credentials, rotation/revocation responsibilities and recovery. | Maintainer decision |
| `OSPS-GV-04.01` | Governance requires roles to be documented before access is granted, but does not define collaborator review before elevated access. | Define review criteria, decision authority and least-privilege access scope in GOVERNANCE; apply the review before granting access. | Maintainer decision |
| `OSPS-QA-02.02` | Compiled SEA distributions are released without SBOMs. A source lockfile and a provenance bundle are different artifacts. | Generate and deliver an SBOM for every compiled release asset; check its components against what the build actually embeds. | To do |
| `OSPS-QA-07.01` | The ruleset requires zero approving reviews. | Establish a second human reviewer and require at least one non-author human approval before merge. Automated and AI reviews do not satisfy this criterion. | Waiting for volunteers |
| `OSPS-VM-04.02` | Dependabot alert 82 (`GHSA-g3hv-75wg-m249`, minimatch via API Extractor) has a written non-exploitability rationale but no VEX document. | Publish a VEX statement with the affected component/version, status and rationale; maintain it as the component or reachability changes. | To do |
| `OSPS-VM-05.01` | Dependency triage does not define remediation thresholds for both vulnerabilities and licenses. | Publish an SCA policy covering identification, severity/license thresholds, prioritization, remediation and justified exceptions. | Maintainer decision |
| `OSPS-VM-05.02` | The release procedure has no SCA policy-compliance gate before each release. | Require a release check against the SCA policy, with applicable violations resolved or documented as permitted exceptions. | To do |
| `OSPS-VM-05.03` | CI and the ruleset do not require an automatic SCA gate for malicious/vulnerable dependencies. | Evaluate every code change against the policy and block merging on violations; test both refusal and justified non-exploitable exceptions. | To do |

These tasks overlap the Best Practices work below: reuse governance, dependency monitoring,
release verification and independent review rather than maintaining separate mechanisms for each badge.

## Corrections due on the badge entry

Saved answers that have become inaccurate, or that cite evidence which no longer resolves. They
are corrected at the next update, once the evidence is in place.

| Criterion | Problem | Correction | Status |
| --- | --- | --- | --- |
| `warnings_strict` | The justification describes test type-checking (#445) as pending. It has landed: `npm run typecheck` checks the `server`, `ui` and `e2e` test suites, and `npm run lint` refuses `@ts-ignore` and undescribed `@ts-expect-error`. | Rewrite the justification, citing [Tests are type-checked](quality.md#tests-are-type-checked). | Done (entry updated 2026-11-07) |
| `signed_releases` | The criterion was unmet: no public release carried provenance, and the cited anchor did not resolve. | The anchor is a heading (#448). v0.61.0 is the first release whose files carry a signed provenance statement, verified with `gh attestation verify` (see Priority 3). Mark the criterion met, citing [Verify a download](sea-packaging.md#verify-a-download). | Ready for the entry |
| `regression_tests_added50` | Met, rightly, but the count of 98 "fix" pull requests includes fixes to the tests themselves (#409, #410), an npm migration (#411) and CodeQL clean-ups; "assertions added" does not show that a test fails without its fix. | At the next review, leave those out and publish the ratio actually computed. The 50% threshold is still met with a wide margin. | Done: of 86 bug-fix pull requests (11 test, migration, CodeQL and documentation fixes left out), 77 (90%) add a new test case; entry updated 2026-11-07 |
| `interfaces_current` | Met, with a known exception in the project's own code: `inlineDynamicImports` in two Vite configurations. | Fix it, then drop the exception from the justification. | Done: fixed (#448), entry updated 2026-11-07 |
| `crypto_password_storage` (N/A) | The OpenSpec change `multi-user-local-accounts` is open: if it introduces passwords, N/A becomes wrong. | Review the answer as soon as that change is merged. | Watch |

## Priority 1 — security and reliable evidence

| Action | Finding and expected outcome | Evidence of completion | Status |
| --- | --- | --- | --- |
| Verify two-factor authentication for the maintainer and every account with write access | Not yet established. Prefer a passkey or hardware key, with protected recovery. Any change to access is the maintainer's decision. | Check the effective settings, without publishing any secret; document who must use 2FA and how it is enforced. Criteria `require_2FA`, `secure_2FA`. | Done: the maintainer (the only account with write access) uses a passkey; the rule for future accounts is in [GOVERNANCE.md](../GOVERNANCE.md#security) |
| Make coverage representative of the product | The main branch reports 96.5% of server lines and 95.4% of UI lines, over the measured scopes. `index.ts` and `embeddedRuntime.ts` are excluded, and tests that run the server as a child process are not aggregated. | Measure statements and branches over an explicit inventory of production sources, excluded modules included, or aggregate reliable integration instrumentation. Publish numerator, denominator and exclusions. Only then claim 80/90% statements and 80% branches. #461 measured the server over unit and integration suites; #465 put every suite through one converter (monocart-coverage-reports), so `shared/src` is credited by server and UI suites together, and counts only lines that produce code (c8 had counted comments, and the converter type declarations, as covered). Three scopes, every file of each, a file no test loads at 0%, exclusions listed with their reason in `scripts/coverage-config.mjs`; the CI summary publishes covered/total per scope and per file. Measured on CI on 8 November, lines/branches/functions: `server/src` 98.8/93.4/98.4%, `shared/src` 98.9/81.5/97.5%, `ui/src` 97.1/87.3/93.7%. Statements are not reported (the converter counts them from generated lines, which differ between the tsx and Vite pipelines). A full Istanbul trial passed on the spike branch ([run 42524597050](https://github.com/laurentftech/pi-outpost/actions/runs/42524597050)); after this workflow is merged, it will publish daily default-branch statements/branches, numerator, denominator and exclusions per scope. Collection checks fail on missing process dumps, and each summary/artifact is tied to the measured commit. Keep this experimental measure separate from PR gates; review full successful daily reports against `test_statement_coverage80`/`90` and `test_branch_coverage80` before making those claims. | In progress: spike trial passed; daily reports begin after merge; review measurements before asserting OpenSSF coverage thresholds |
| Write a verifiable security argument | Trust boundaries and limits are documented ([SECURITY.md](../SECURITY.md), [Sandboxing](sandboxing.md)); the argument linking threats, controls and tests is not yet written down in one place. | `docs/security-assurance.md`: assets, attackers, boundaries, controls, the negative tests behind them, residual risks. A dated review and follow-up of its findings. Criteria `assurance_case`, `security_review`. A badge-entry audit is not a security review and is not presented as one. | To do |
| Clarify secure-by-default transport | Native HTTPS/WSS and remote HTTP refusal are implemented in `secure-remote-transport`, with an explicit protected-hop exception and documented SSH forwarding. Token enforcement remains mandatory off loopback. | Merge/release this change, then complete the inventory of outbound provider, MCP and separate service flows before claiming `crypto_used_network`. See [deployment](deployment.md#remote-transport-https-or-ssh) and the scenario matrix in `openspec/changes/secure-remote-transport/scenario-coverage.md`. | In progress |
| Pin the npm installs Scorecard reports | The repository's open code-scanning alerts are **Scorecard** findings (CodeQL and Dependabot have none open). 17 are Pinned-Dependencies: `npm install -g npm@12.2.1` in `ci.yml`, `release.yml`, `docker-python.yml` and three Dockerfiles, plus two global installs of pi-outpost itself (`deploy/docker/Dockerfile`, `scripts/team-install/install.sh`). | Install npm 12.2.1 with `npm ci` from a dedicated lockfile, which carries its integrity hash, in the workflows and Dockerfiles. The two installs of pi-outpost from the registry name a released version on purpose: dismiss those alerts with a written reason. The Scorecard score should rise, and the release workflow's provenance benefits. The lockfile also exposes the advisories inside npm's own bundle: see "Track the advisories bundled in npm". | Done (#450); the two pi-outpost alerts dismissed with their reason (#253, #258) |
| Address the other Scorecard findings | Scan of 8 November: Branch-Protection 4 (unchanged after stale review dismissal was enabled; the next levels require approvals), Code-Review 0 (no change approved by a second person), Fuzzing 0, Signed-Releases 0 (the scan predates v0.61.0, the first release with provenance), Contributors 3, Pinned-Dependencies 9 (dismissed alerts still count). | Branch protection: a repository setting (maintainer decision). Code review: the same need as `two_person_review`, which no setting can meet without a second person. Fuzzing: consider targeted fuzzing of the parsers (structured exchange, mail, zip); do not add it for show. | Stale review dismissal enabled on 2026-11-07. Code review waits for volunteer reviewers. Fuzzing: To do |
| Track the advisories bundled in npm | Since #450, `tools/npm/package-lock.json` makes the dependencies npm bundles visible to `npm audit` and Dependabot. The lockfile first recorded stale bundled versions: `npm install --package-lock-only` cannot read the tarball, so for npm 12.2.2 it wrote `undici` 6.29.0 and `ip-address` 10.7.2, while the published tarball ships the fixed 6.29.1 and 10.7.5. Dependabot's #453 corrected the lockfile, and #457 changed the bump procedure to a full install. 4 alerts remain, all moderate: `glob` 13.0.6 and `minimatch` 10.2.5, used by npm for local pattern matching, in both copies of the lockfile. | Move to each npm release as it comes out ([procedure](development.md#the-pinned-npm)), checking the lockfile against the installed bundle. Until a release bundles fixed `glob` and `minimatch`, dismiss those 4 alerts as a tolerated risk with that reason. | In progress |
| Keep dependency monitoring effective | Monitoring through GitHub is confirmed and documented: 88 Dependabot alerts fixed, one dismissed, 4 open on 8 November (the bundled npm advisories are tracked above). Alerts cover npm; only **version updates** do not (they are configured for `github-actions` and `docker`). | Before enabling npm version updates, check that Dependabot can write an npm 12.2.2 lockfile, the version the project requires; otherwise its pull requests would break that rule. Keep a reason for every dismissed alert, track embedded components, and keep CodeQL, Scorecard, dependency alerts and Socket apart. Never force an update blindly. | To do |

## Priority 2 — concrete repository work

| Action | Proposed implementation | Validation | Status |
| --- | --- | --- | --- |
| Remove deprecated Vite options | Replace `inlineDynamicImports` in `mcp/viewer/vite.config.ts` and `vite.poster.config.ts` with the option the installed version recommends (`codeSplitting: false`), if equivalent. Track `node-domexception` in the Google SDK chain as upstream debt. | Both viewers build, their bundles and imports are checked, MCP tests pass, and the viewers are exercised in the running app. Both bundles came out byte-identical, so the running app needs no separate check. | Done (#448) |
| Regenerate the lockfile with npm 12.2.1 | A development dependency (`jszip`) was added in #438 with a lockfile written by npm 11, against the current rule. | Regenerated with `npx -y npm@12.2.1 install --package-lock-only` on `main`: no difference, so the lockfile already matches npm 12.2.1. Nothing to commit. | Done |
| Make code style and review explicit | A short TypeScript/React guide, the rules actually automated, and a review checklist: behaviour, tests, security boundaries, documentation, dependencies. | Guide linked from CONTRIBUTING, consistent configurations, passing and refused examples. Lint rules are not full formatting. Criteria `coding_standards`, `coding_standards_enforced`, `code_review_standards`. | To do |
| Complete governance and roles | Document how the project works today: the maintainer, decisions, acceptance of contributions, releases and security handling. Propose a code of conduct for explicit adoption. | Public documents that match the actual permissions, reviewed by the maintainer before they commit the project. Criteria `governance`, `roles_responsibilities`, `code_of_conduct`. | Done: [GOVERNANCE.md](../GOVERNANCE.md), [CODE_OF_CONDUCT.md](../CODE_OF_CONDUCT.md) (Contributor Covenant 2.1) merged (#455); the three criteria are met on the entry |
| Publish a twelve-month roadmap | [Product roadmap](roadmap.md): direction from November 2026 through 2027, priorities, exclusions and individual-maintainer constraints. There are no delivery deadlines or fixed review commitments. | Merge the roadmap and its README link, then update `documentation_roadmap` with the public URL. Review the text when direction or capacity changes. | In progress: roadmap prepared; badge answer follows publication |
| Identify small contributions | A few self-contained tasks with a reproduction, a scope, likely files and acceptance criteria. | Public issues labelled `good first issue`, doable without knowing the whole architecture. None was open at the last check. Criterion `small_tasks`. | To do |
| Check accessibility beyond axe | Keep the existing scans and add keyboard, focus, zoom, contrast and screen-reader passes on the essential flows. | Reproducible results on chat, questions, menus, files and documents, with issues tracked. An automated scan is not full conformance. | To do |
| Prepare localisation | Inventory user-facing text and choose a gradual strategy for messages, plurals, dates and numbers. A SHOULD criterion: a justified "unmet" is acceptable, and building a full localisation framework only for the badge would be disproportionate. | A second locale verified in the running app, with a fallback, if one is genuinely useful. Being free software does not imply internationalisation. | Maintainer decision |

## Priority 3 — distribution and continuity

| Action | Finding and proposal | Evidence of completion | Status |
| --- | --- | --- | --- |
| Verify signatures at the next release | v0.61.0 (8 November 2026) is the first release built with the provenance step (#436). | Checked on the public release: `gh attestation verify` accepts `pi-outpost-plannings.mcpb`, signed by `release.yml` at `refs/tags/v0.61.0`, and the one statement covers the three executables and both MCP bundles; an altered file is refused. The `pi-outpost-0.61.0.sigstore.json` bundle is attached for offline checks, and the npm package `pi-outpost@0.61.0` carries SLSA v1 provenance. Still to document per channel: the Docker image. Provenance, OS code signing and reproducibility remain three different guarantees. | Done for the release files and npm |
| Sign every future important tag | Of 104 tags, 103 before v0.61.0: 59 annotated, 41 of them with a valid signature, and 44 lightweight. v0.22.0, v0.30.0 and v0.53.0 are unsigned; v0.60.1 is signed. **v0.61.0 was pushed as a lightweight, unsigned tag**, against the release procedure ([step 7](development.md#releasing)), which relies on the releasing machine having `tag.gpgsign` on. | Make the release workflow refuse a tag that is not an annotated, verified signed tag, before it builds anything, so the procedure no longer depends on local git settings. Public instructions for users. Existing tags, v0.61.0 included, are never moved or replaced to improve the entry. Criterion `version_tags_signed`. | To do |
| Test repeatable, then reproducible, builds | A lockfile does not prove a bit-for-bit identical result; the bundles and executables make the question applicable. | Two clean builds compared by hash, then a reproduction in an independent environment, looking for timestamps, absolute paths and variable metadata. Criteria `build_repeatable`, `build_reproducible`. | To do |
| Per-file licence and copyright notices | A root LICENSE does not meet the two gold per-file criteria. A large diff for a gold criterion: left until silver is reached. | SPDX and copyright notices on the files the project holds rights to, third-party attributions preserved, and an automated inventory check. Criteria `copyright_per_file`, `license_per_file`. | To do (after silver) |
| Prepare project continuity | No one else can currently take over issues, merges and releases within a week, and there is no second independent human contributor. | Choose a trusted person, define minimal permissions, a recovery mechanism and a tested procedure; any delegation of access is an explicit decision. Criteria `access_continuity`, `bus_factor`, `contributors_unassociated`. | Waiting for volunteers |
| Grow independent human review | Automated checks and AI reviews do not show that another person reviewed a change. | Welcome a second contributor and record reviews; measure the share of changes reviewed before release. Documentation alone does not meet `two_person_review`. | Waiting for volunteers |

## Found along the way

Defects found during the audit that no criterion asks about, tracked here so they are not lost.

| Finding | Fix | Status |
| --- | --- | --- |
| A session whose first turn starts with a tool call was titled from the question alone: `firstExchange` stopped at the first assistant message, which carries only the tool call, so the reply never reached the title model. | Take the first assistant message that has text; regression tests for a tool-first turn and a turn with no text reply. | Done (#449) |

## Cryptography: proportionate improvement

Inventory TLS, file hashes and the server token comparison separately. Identify which play a
security role and what migration would be needed if an algorithm became inadequate. TLS negotiates
among several suites; an application use fixed to SHA-256 is not agile by itself. Do not add a
selector of weak algorithms to satisfy `crypto_algorithm_agility`: prefer maintained primitives,
versioned formats where needed, and a tested migration procedure.

## Recommended order

1. Two-factor authentication (done) and the monitoring evidence already in place.
2. Simple fixes: the Vite option, the lockfile and the verification heading; the npm pinning.
3. Correct the badge-entry answers listed above, once their evidence is in place.
4. Consolidate style, review, governance and the security argument.
5. Measure the missing coverage; keep verifying signed release files, and document Docker provenance.
6. Organise continuity and independent contribution: gold cannot be reached through code or
   badge-entry changes alone.

## Change log

| Date | Change |
| --- | --- |
| 2026-11-08 | Prepared the product roadmap through 2027, with explicit exclusions and individual-maintainer constraints, and linked it from the README. Publication and the `documentation_roadmap` entry update follow review and merge. |
| 2026-11-07 | Initial audit and two updates of the badge entry (passing 100%, silver 53%, gold 30%). |
| 2026-11-07 | Test suites type-checked (#445). |
| 2026-11-07 | Review: Scorecard findings, corrections due on the entry, Dependabot and npm 12, per-file notices and localisation nuances. Status added to every action. Plan published in the repository. |
| 2026-11-07 | Lockfile checked against npm 12.2.1: already consistent. Pull requests opened for the Vite option and verification heading (#448), session titles after a tool call (#449) and npm pinned by hash (#450). |
| 2026-11-07 | Merged: #448 (Vite option, verification heading), #449 (session titles), #450 (npm pinned by hash). Added: move to npm 12.2.2. |
| 2026-11-07 | Moved to npm 12.2.2. Correction: it bundles the same `undici` as 12.2.1, so the high advisory stays; the bundled advisories are now tracked as their own action. |
| 2026-11-07 | npm 12.2.2 merged (#452). Scorecard pinning alerts on the two pi-outpost installs dismissed as "won't fix" with a written reason; Scorecard open alerts: 3 (Branch-Protection, Code-Review, Fuzzing). |
| 2026-11-07 | Maintainer decisions: 2FA confirmed (passkey); governance and Contributor Covenant 2.1 adopted; stale review dismissal enabled on `main`. Product roadmap deferred; second reviewer and continuity wait for volunteers. |
| 2026-11-08 | Correction of the 2026-11-07 correction: npm 12.2.2 does bundle the fixed `undici` 6.29.1 and `ip-address` 10.7.5; only the lockfile recorded stale versions. Merged: #453 (lockfile matches the tarball; Dependabot alerts down from 16 to 4), #455 (governance, code of conduct), #456 (both count as documentation in CI), #457 (full install to bump npm). |
| 2026-11-08 | v0.61.0 released. Its files' provenance and the npm provenance verified; `signed_releases` ready for the entry. Its tag is lightweight and unsigned: the workflow should refuse such a tag. |
| 2026-11-08 | Counts refreshed: entry at passing 100%, silver 67%, gold 39% (governance, code of conduct, 2FA, `warnings_strict`, `interfaces_current` and `regression_tests_added50` updated on 7 November); Scorecard 7.3; Dependabot 88 fixed, 1 dismissed, 4 open. |
| 2026-11-08 | Security Baseline audit saved: Level 1 achieved (23 Met, 1 N/A); Level 2 15/19 and Level 3 11/21, with no unknown answers. Added the 14 unmet controls, completion evidence and the official Baseline badge. Verified all five v0.61.0 release files against their signer workflow/tag; an altered file is rejected. |
| 2026-11-08 | Coverage measured over unit and integration suites and the full `server/src` and `shared/src` inventory (#461): statements 95.0%, branches 87.3%, functions 96.3%, thresholds 94/86/95. |
| 2026-11-08 | Coverage through one converter for the server and UI suites (#465): `shared/src` credited by both, lines of code only, three scopes with their own thresholds. Vitest 5.1.0 (#464). |
