# OpenSSF Best Practices: status and plan

pi-outpost holds the OpenSSF Best Practices **passing** badge
([project 16423](https://www.bestpractices.dev/en/projects/16423)). This page records where the
project stands against the **silver** and **gold** levels, what it intends to do about each gap,
and what has changed. It is kept up to date as work lands, and read before every update of the
badge entry.

It proposes work; it does not claim it done. An action is **Done** only once its evidence is
public, and the badge entry is changed only after that. Scope: Best Practices passing, silver and
gold — not the separate OpenSSF Security Baseline. Criteria:
[silver](https://www.bestpractices.dev/en/criteria/1), [gold](https://www.bestpractices.dev/en/criteria/2).

Status values: **To do** · **In progress** (pull request open) · **Done** (public evidence) ·
**Maintainer decision** (a commitment only the maintainer can make).

## Current standing

As of 7 November 2026: passing 100%, silver 53%, gold 30%. The public entry lists every answer
and its justification. Supporting evidence for the checks this repository runs is in
[Code quality and verification](quality.md).

## Corrections due on the badge entry

Saved answers that have become inaccurate, or that cite evidence which no longer resolves. They
are corrected at the next update, once the evidence is in place.

| Criterion | Problem | Correction | Status |
| --- | --- | --- | --- |
| `warnings_strict` | The justification describes test type-checking (#445) as pending. It has landed: `npm run typecheck` checks the `server`, `ui` and `e2e` test suites, and `npm run lint` refuses `@ts-ignore` and undescribed `@ts-expect-error`. | Rewrite the justification, citing [Tests are type-checked](quality.md#tests-are-type-checked). | To do |
| `signed_releases` (partial evidence) | The link to `sea-packaging.md#verify-a-download` does not resolve: the passage is a bold paragraph, not a heading. | Make it a heading, then check the link. The criterion stays unmet until a public release carries provenance. | Heading added (#448); the link now resolves |
| `regression_tests_added50` | Met, rightly, but the count of 98 "fix" pull requests includes fixes to the tests themselves (#409, #410), an npm migration (#411) and CodeQL clean-ups; "assertions added" does not show that a test fails without its fix. | At the next review, leave those out and publish the ratio actually computed. The 50% threshold is still met with a wide margin. | Recomputed: of 86 bug-fix pull requests (11 test, migration, CodeQL and documentation fixes left out), 77 (90%) add a new test case; justification to update |
| `interfaces_current` | Met, with a known exception in the project's own code: `inlineDynamicImports` in two Vite configurations. | Fix it, then drop the exception from the justification. | Fixed (#448); justification to update |
| `crypto_password_storage` (N/A) | The OpenSpec change `multi-user-local-accounts` is open: if it introduces passwords, N/A becomes wrong. | Review the answer as soon as that change is merged. | Watch |

## Priority 1 — security and reliable evidence

| Action | Finding and expected outcome | Evidence of completion | Status |
| --- | --- | --- | --- |
| Verify two-factor authentication for the maintainer and every account with write access | Not yet established. Prefer a passkey or hardware key, with protected recovery. Any change to access is the maintainer's decision. | Check the effective settings, without publishing any secret; document who must use 2FA and how it is enforced. Criteria `require_2FA`, `secure_2FA`. | Done: the maintainer (the only account with write access) uses a passkey; the rule for future accounts is in [GOVERNANCE.md](../GOVERNANCE.md#security) |
| Make coverage representative of the product | The main branch reports 96.5% of server lines and 95.4% of UI lines, over the measured scopes. `index.ts` and `embeddedRuntime.ts` are excluded, and tests that run the server as a child process are not aggregated. | Measure statements and branches over an explicit inventory of production sources, excluded modules included, or aggregate reliable integration instrumentation. Publish numerator, denominator and exclusions. Only then claim 80/90% statements and 80% branches. | To do |
| Write a verifiable security argument | Trust boundaries and limits are documented ([SECURITY.md](../SECURITY.md), [Sandboxing](sandboxing.md)); the argument linking threats, controls and tests is not yet written down in one place. | `docs/security-assurance.md`: assets, attackers, boundaries, controls, the negative tests behind them, residual risks. A dated review and follow-up of its findings. Criteria `assurance_case`, `security_review`. A badge-entry audit is not a security review and is not presented as one. | To do |
| Clarify secure-by-default transport | Local access uses HTTP; remote deployment recommends a reverse proxy or Tailscale. The server already requires a token off loopback. That does not by itself make every connection secure by default. | Inventory the flows and the secrets they carry; refuse, or require explicit configuration for, unencrypted transport outside a justified local context; test configuration and TLS failure. Refusing non-local HTTP without an explicit option is a product decision. Criterion `crypto_used_network`. | Maintainer decision |
| Pin the npm installs Scorecard reports | The repository's open code-scanning alerts are **Scorecard** findings (CodeQL and Dependabot have none open). 17 are Pinned-Dependencies: `npm install -g npm@12.2.1` in `ci.yml`, `release.yml`, `docker-python.yml` and three Dockerfiles, plus two global installs of pi-outpost itself (`deploy/docker/Dockerfile`, `scripts/team-install/install.sh`). | Install npm 12.2.1 with `npm ci` from a dedicated lockfile, which carries its integrity hash, in the workflows and Dockerfiles. The two installs of pi-outpost from the registry name a released version on purpose: dismiss those alerts with a written reason. The Scorecard score should rise, and the release workflow's provenance benefits. The lockfile also exposes the advisories inside npm's own bundle: see "Track the advisories bundled in npm". | Done (#450); the two pi-outpost alerts dismissed with their reason (#253, #258) |
| Address the other Scorecard findings | Branch-Protection (score 4: stale review dismissal is off on `main`), Code-Review (0 of 26 changes approved), Fuzzing (none). | Branch protection: a repository setting (maintainer decision). Code review: the same need as `two_person_review`, which no setting can meet without a second person. Fuzzing: consider targeted fuzzing of the parsers (structured exchange, mail, zip); do not add it for show. | Stale review dismissal enabled on 2026-11-07. Code review waits for volunteer reviewers. Fuzzing: To do |
| Track the advisories bundled in npm | Since #450, the lockfile in `tools/npm` makes the dependencies npm bundles visible to `npm audit` and Dependabot: 16 open alerts, on `undici` 6.29.0 (high; used only by `node-gyp`, when it downloads Node headers to build `node-pty`), `ip-address` (via `socks`, SOCKS proxies only), `glob` and `minimatch` (local pattern matching). The same code ran before through `npm install -g`. Bundled packages cannot be updated on their own; Dependabot's update attempt failed. The latest release, npm 12.2.2, still bundles the same versions. | Move to each npm release as it comes out ([procedure](development.md#the-pinned-npm)). Until a release bundles fixed versions, dismiss the alerts as a tolerated risk with that reason, and re-check at each npm release. | In progress (npm 12.2.2) |
| Keep dependency monitoring effective | Monitoring through GitHub is confirmed and documented: 76 Dependabot alerts fixed, one dismissed, none open before #450 (the bundled npm advisories are tracked above). Alerts cover npm; only **version updates** do not (they are configured for `github-actions` and `docker`). | Before enabling npm version updates, check that Dependabot can write an npm 12.2.2 lockfile, the version the project requires; otherwise its pull requests would break that rule. Keep a reason for every dismissed alert, track embedded components, and keep CodeQL, Scorecard, dependency alerts and Socket apart. Never force an update blindly. | To do |

## Priority 2 — concrete repository work

| Action | Proposed implementation | Validation | Status |
| --- | --- | --- | --- |
| Remove deprecated Vite options | Replace `inlineDynamicImports` in `mcp/viewer/vite.config.ts` and `vite.poster.config.ts` with the option the installed version recommends (`codeSplitting: false`), if equivalent. Track `node-domexception` in the Google SDK chain as upstream debt. | Both viewers build, their bundles and imports are checked, MCP tests pass, and the viewers are exercised in the running app. Both bundles came out byte-identical, so the running app needs no separate check. | Done (#448) |
| Regenerate the lockfile with npm 12.2.1 | A development dependency (`jszip`) was added in #438 with a lockfile written by npm 11, against the current rule. | Regenerated with `npx -y npm@12.2.1 install --package-lock-only` on `main`: no difference, so the lockfile already matches npm 12.2.1. Nothing to commit. | Done |
| Make code style and review explicit | A short TypeScript/React guide, the rules actually automated, and a review checklist: behaviour, tests, security boundaries, documentation, dependencies. | Guide linked from CONTRIBUTING, consistent configurations, passing and refused examples. Lint rules are not full formatting. Criteria `coding_standards`, `coding_standards_enforced`, `code_review_standards`. | To do |
| Complete governance and roles | Document how the project works today: the maintainer, decisions, acceptance of contributions, releases and security handling. Propose a code of conduct for explicit adoption. | Public documents that match the actual permissions, reviewed by the maintainer before they commit the project. Criteria `governance`, `roles_responsibilities`, `code_of_conduct`. | In progress: [GOVERNANCE.md](../GOVERNANCE.md), [CODE_OF_CONDUCT.md](../CODE_OF_CONDUCT.md) (Contributor Covenant 2.1) |
| Publish a twelve-month roadmap | Directions, exclusions and constraints, without unrealistic dates. This page is a work plan for the badge, not the product roadmap the criterion asks for. | A dated page reviewed regularly. A set of issues alone does not say what is out of scope. Criterion `documentation_roadmap`. | Later (maintainer) |
| Identify small contributions | A few self-contained tasks with a reproduction, a scope, likely files and acceptance criteria. | Public issues labelled `good first issue`, doable without knowing the whole architecture. None was open at the last check. Criterion `small_tasks`. | To do |
| Check accessibility beyond axe | Keep the existing scans and add keyboard, focus, zoom, contrast and screen-reader passes on the essential flows. | Reproducible results on chat, questions, menus, files and documents, with issues tracked. An automated scan is not full conformance. | To do |
| Prepare localisation | Inventory user-facing text and choose a gradual strategy for messages, plurals, dates and numbers. A SHOULD criterion: a justified "unmet" is acceptable, and building a full localisation framework only for the badge would be disproportionate. | A second locale verified in the running app, with a fallback, if one is genuinely useful. Being free software does not imply internationalisation. | Maintainer decision |

## Priority 3 — distribution and continuity

| Action | Finding and proposal | Evidence of completion | Status |
| --- | --- | --- | --- |
| Verify signatures at the next release | The release workflow attests build provenance with Sigstore (#436), but the last public release checked, v0.60.1, predates it. | After the next release: download and verify the public artifacts and the build identity; document verification for each distribution channel. Provenance, OS code signing and reproducibility are three different guarantees. | To do |
| Sign every future important tag | Of 103 tags: 59 annotated, 41 of them with a valid signature, and 44 lightweight. v0.22.0, v0.30.0 and v0.53.0 are unsigned; v0.60.1 is signed. | A verification step before publishing, and public instructions for users. Existing tags are never moved or replaced to improve the entry. Criterion `version_tags_signed`. | To do |
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
5. Measure the missing coverage and verify the next signed release.
6. Organise continuity and independent contribution: gold cannot be reached through code or
   badge-entry changes alone.

## Change log

| Date | Change |
| --- | --- |
| 2026-11-07 | Initial audit and two updates of the badge entry (passing 100%, silver 53%, gold 30%). |
| 2026-11-07 | Test suites type-checked (#445). |
| 2026-11-07 | Review: Scorecard findings, corrections due on the entry, Dependabot and npm 12, per-file notices and localisation nuances. Status added to every action. Plan published in the repository. |
| 2026-11-07 | Lockfile checked against npm 12.2.1: already consistent. Pull requests opened for the Vite option and verification heading (#448), session titles after a tool call (#449) and npm pinned by hash (#450). |
| 2026-11-07 | Merged: #448 (Vite option, verification heading), #449 (session titles), #450 (npm pinned by hash). Added: move to npm 12.2.2. |
| 2026-11-07 | Moved to npm 12.2.2. Correction: it bundles the same `undici` as 12.2.1, so the high advisory stays; the bundled advisories are now tracked as their own action. |
| 2026-11-07 | npm 12.2.2 merged (#452). Scorecard pinning alerts on the two pi-outpost installs dismissed as "won't fix" with a written reason; Scorecard open alerts: 3 (Branch-Protection, Code-Review, Fuzzing). |
| 2026-11-07 | Maintainer decisions: 2FA confirmed (passkey); governance and Contributor Covenant 2.1 adopted; stale review dismissal enabled on `main`. Product roadmap deferred; second reviewer and continuity wait for volunteers. |
