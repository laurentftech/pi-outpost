# Contributing to pi-outpost

Bug reports, documentation improvements and focused pull requests are welcome. For a suspected
vulnerability, use the private reporting process in [SECURITY.md](SECURITY.md). Everyone taking
part follows the [code of conduct](CODE_OF_CONDUCT.md); [GOVERNANCE.md](GOVERNANCE.md) explains
who decides, merges and releases.

## Before starting

Search existing [issues](https://github.com/laurentftech/pi-outpost/issues) and
[pull requests](https://github.com/laurentftech/pi-outpost/pulls). For a substantial feature or
architectural change, describe the problem and proposed scope in an issue first. For a bug, include
the pi-outpost version, OS, runtime/sandbox runner, minimal reproduction and expected behaviour.
Redact tokens, provider keys, personal documents and conversation content from shared logs.

The [new issue chooser](https://github.com/laurentftech/pi-outpost/issues/new/choose) provides a bug
report form and a feature request form, plus a link to private security reporting. Blank issues
remain available for other requests, including asking for a private contact channel without
publishing vulnerability details.

## Development setup

Use Node.js 24 (the main CI runtime), Git and **npm 12.2.2**. Native terminal dependencies may
require Python and a C/C++ toolchain. Node 26 is used separately for release executable builds.

```sh
npm install -g npm@12.2.2
npm ci
npm run dev
```

The committed development configuration is used by `npm run dev`. See
[development](docs/development.md) for the repository layout, configuration and platform details.
Keep credentials and local configuration out of commits. Check the diff, including untracked
files, before publishing a branch.

## Changes and tests

Keep a PR focused on one problem. Follow the surrounding TypeScript and React conventions. Prefer
small modules with explicit ownership and observable outcomes. Preserve public behaviour unless
the change deliberately updates it; avoid unrelated formatting and dependency churn.

New or changed behaviour comes with automated tests in the relevant suite, and a bug fix with a
test that fails without it. A test must assert the outcome (in the UI suites, lint refuses a test
with no assertion). Where the change has OpenSpec scenarios, CI also checks that each one is
mapped to its test (see below).

Run the checks relevant to the change. These are the common starting points:

```sh
npm run typecheck
npm run lint
npm test --workspace server
npm test --workspace ui
```

The [quality guide](docs/quality.md) describes what these checks enforce and their limitations.
`npm run typecheck` includes all TypeScript test suites, including server fixtures and
Playwright support files. New test files in those directories are included automatically.
Fix stale assertions and fixtures rather than silencing diagnostics. Lint rejects
`@ts-ignore`, `@ts-nocheck` and `@ts-expect-error` without a description in UI sources,
server tests and e2e. JavaScript tests are not type-checked.
The full CI also exercises the other workspaces, packaging and platform-specific sandbox runners.
Use `path.join`/`path.resolve` in portable tests, account for CRLF, and use the existing Windows
process-launch helpers rather than invoking `npm.cmd` as an executable.

For user-visible or agent-facing behaviour, test the built running app as well as the unit code:

```sh
npm run build
npx playwright install chromium
npm run test:e2e
```

Linux may also need Playwright's system dependencies; see [testing](docs/development.md#tests).
Assert the resulting DOM, files or transcript. A screenshot alone does not prove behaviour.
Include a second pass that changes or removes state while the interaction is in progress.
Ordinary integration/browser tests use isolated fixtures and do not need paid model calls.
The separate live suite requires model authentication and can incur charges.

Follow [AGENTS.md](AGENTS.md) for the repository's OpenLore/OpenSpec workflow. Where a change has
OpenSpec scenarios, map every applicable scenario to assertions in `scenario-coverage.md` and run
strict validation. Do not weaken an assertion or a sandbox check to get a green run.

## Dependencies and security-sensitive changes

Regenerate `package-lock.json` with npm 12.2.2 when changing dependencies or package versions.
Review new install scripts explicitly: `.npmrc` and `allowScripts` reject unreviewed scripts.
Keep the Playwright package and CI container versions aligned. Retain third-party license notices.

Changes to authentication, WebSocket authorization, path confinement, sandbox grants, extension
trust, HTML/document rendering, credentials or publishing need explicit negative-case tests and
review of the relevant trust boundary. Describe any permission change in the PR.

## Pull requests

Explain the problem and resulting behaviour, the validation performed and any remaining limits.
Update affected user/developer documentation in the same PR, and include a **Documentation impact**
note listing the files changed (or explain why none are affected). Confirm the applicable CI jobs
on the current PR commit before merging; report a real failure rather than bypassing it.

Project releases are handled by maintainers using the
[release procedure](docs/development.md#releasing). Contributions are made under the project's
[MIT license](LICENSE); preserve the licenses of any separately licensed material.
