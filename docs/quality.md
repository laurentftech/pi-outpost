# Code quality and verification

This page describes executable checks and known limits, so contributors and reviewers can assess
the evidence behind a green build. See [CONTRIBUTING.md](../CONTRIBUTING.md) for the contribution
workflow and [SECURITY.md](../SECURITY.md) for private vulnerability reports.

## Checks in the repository

| Control | Implementation | Scope and limits |
|---|---|---|
| Type checking | `npm run typecheck`, workspace and e2e TypeScript configurations | Strict TypeScript includes all TypeScript test suites and their support files. It does not validate runtime inputs by itself. |
| Lint | `npm run lint`, workspace Oxlint configurations | Includes `server/src`; selected correctness rules fail the build. The server permits at most 43 existing warnings. This ceiling prevents the total growing; it does not prove each new line is warning-free. |
| Static analysis | [CodeQL workflow](../.github/workflows/codeql.yml) | Actions, C# and JavaScript/TypeScript on PRs, main and weekly. JS/TS uses `security-and-quality`; other languages retain default queries. Findings still need review. |
| Unit and integration tests | [CI workflow](../.github/workflows/ci.yml), workspace test scripts | Main suites run on Ubuntu and Windows; real HTTP/WebSocket tests use isolated server processes. Native install checks also run on macOS. |
| Browser checks | `npm run test:e2e`, `npm run test:webbench` | Built app/widget flows; the bench covers Chromium, Firefox, WebKit and selected axe accessibility scans. These are bounded scenarios, not exhaustive accessibility or UI certification. |
| Coverage thresholds | `server/package.json`, `ui/package.json` | Server unit suites: lines 92%, branches 86%, functions 90%. UI: lines 91%, branches 85%, functions 93%. These are minimum thresholds, not claimed current measurements. |
| Spec scenario inventory | `scripts/check-scenario-coverage.mjs` | Checks a touched change's scenario matrix and cited files. A reviewer must still read the assertions and verify their outcomes. |
| Packaging and confinement | CLI install, container, MCP bundle and native sandbox tests | Exercises installed/native artifacts and refusals. Some jobs run only on specific platforms or changed paths; use their actual result for the change. |
| Install and publication policy | `.npmrc`, root `allowScripts`, release workflow | npm 12.2.1 rejects unreviewed install scripts; npm publication uses GitHub OIDC/provenance. Dependencies and upstream advisories still need review. |

## Tests are type-checked

`npm run typecheck` checks server sources and TypeScript tests through
`server/tsconfig.test.json`, UI sources and tests through `ui/tsconfig.json`, and
Playwright specs and support files through `e2e/tsconfig.json`. Office, Open WebUI,
posters and MCP already include their tests in their workspace configurations.
There is no tolerated type-error ceiling. JavaScript tests (`.mjs`) are outside this check.

`npm run test:scripts` compares tracked test files with the compiler's actual file list
and verifies that new ill-typed files fail the check. Lint rejects `@ts-ignore`,
`@ts-nocheck` and unexplained `@ts-expect-error` comments in the UI, server tests and e2e.
Type checking complements runtime assertions; it cannot prove that a test observes the
right behaviour or that an untyped helper's declaration matches its implementation.

The e2e compiler resolves the embed package's API from its source, so type checking
works before the package is built. Browser tests still import its built public entry point.

## What the coverage badge means

Server coverage instruments the `.test.ts` unit suites. It excludes `server/src/index.ts`,
`server/src/embeddedRuntime.ts`, generated code and the bundled reference validator. The `.mjs`
integration suites exercise real server subprocesses whose execution is not included in that
unit coverage total. The UI has its own Vitest coverage report.

The badge therefore describes the measured scopes, **not whole-repository or end-to-end coverage**.
In particular, it does not measure the central server entry point. Inspect the integration/browser
assertions for those behaviours. The [development guide](development.md#tests) explains the
instrumentation constraints; the coverage command and CI summary are the source of truth.

## Warning and maintainability debt

The first server lint baseline contains 43 warnings, mostly unused bindings and unnecessary spreads,
with some intentional regular-expression/control-character and protocol-shape warnings. Important
correctness checks such as duplicate keys, unreachable code, unsafe `finally` and invalid `typeof`
are errors. New syntax errors and those errors fail regardless of the warning ceiling.

Review warnings in the changed code. Lower the ceiling as warnings are removed; do not raise it or
add a blanket disable to hide a regression. An intentional exception needs a narrow explanation.
Other workspaces currently have their own rules and warning handling; there is no repository-wide
zero-warning claim or enforced complexity score.

`server/src/index.ts` and `ui/src/useAgent.ts` are large coordination modules. Strong test suites do
not remove their maintenance cost. Prefer extracting cohesive handlers/state transitions behind
existing wire/browser regression tests when changing these areas. Avoid an untested mass rewrite
or a file-size threshold that merely encourages moving code without improving ownership.

## Merge enforcement

As set on 2026-11-07, the active [protect_main ruleset](https://github.com/laurentftech/pi-outpost/rules/22049027)
on `main`:

- requires a pull request, and prevents deletion and force-push;
- requires these status checks to pass, on a branch up to date with `main`:
  - `CI ok`, the CI job that waits for all the others (`check`, `npm-install`, `browser`,
    `mxc-linux`, `mxc-macos`) and fails if any of them failed or was cancelled;
  - `Analyze (actions)`, `Analyze (csharp)` and `Analyze (javascript-typescript)`;
- blocks a merge on a CodeQL alert of high severity or above;
- has **no bypass**: administrators are held to the same checks;
- requires zero approving reviews (the project has one maintainer).

No legacy branch protection is set on `main`; the ruleset is the only rule. This is a snapshot:
verify the live ruleset when reviewing enforcement. If CI is broken by something outside the
repository (a runner outage), the ruleset has to be relaxed explicitly by an administrator; there
is no silent bypass.

Requiring `CI ok` rather than each job keeps the rule valid when jobs are added, and does not
wait forever on a matrix job that was skipped (a skipped matrix reports no per-platform check).

Do not make the path-filtered Docker recipe job a universal requirement: it can be absent on an
unrelated PR.

### Documentation-only pull requests

A pull request that only changes documentation skips the test jobs; `CI ok` passes once the
classification has run, and CodeQL still runs, so such a PR can merge in minutes rather than
waiting for the full suites. A push to `main` always runs everything.

The CI's `changes` job decides. Documentation only means: `README.md`, `CONTRIBUTING.md`,
`SECURITY.md`, `CLAUDE.md`, `AGENTS.md`, the issue and pull request templates, and files under
`docs/` whose path no other file names. Everything else runs the full CI, including `openspec/`
(the scenario-coverage check), `skills/` and `CHANGELOG.md`, which tests read and the packages
ship.

Some `docs/` pages are contracts: tests validate the examples in the structured-exchange guides,
and the CLI build copies them into the package. The classification recognises them because those
tests and scripts name them by full path. So **a test or script that reads a file under `docs/`
must spell its repository path in full** (`"docs/<page>.md"`), not assemble it from parts: a
page named that way is always tested; one reached through `path.join("docs", name)` would be
skipped on a documentation-only PR. A mention in a code comment or a user-facing link also counts
as naming a page; that only makes such a page's PRs run the full CI. Review approval count, administrator exceptions and whether the branch must be up
to date are repository governance decisions. Verify the live ruleset when reviewing enforcement;
this document does not change those settings or claim an independent review already happened.
