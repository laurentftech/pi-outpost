# Tasks

## 1. Git failures name their cause

- [x] 1.1 Make `gitFailureMessage` (`server/src/git.ts`) return the first `fatal:` / `error:` stderr line, else the last non-empty line, splitting on `/\r?\n/`; verify in `server/test/git-failure-message.test.ts` with a progress-then-fatal output (LF and CRLF), a single-line output, and an output with neither prefix (scenarios *GitsOwnWordsAreKept*, *AProgressLineIsNotTheReason*)
- [x] 1.2 Stop re-cutting git errors with `firstLine` in `server/src/resourceRepositories.ts` (clone at the `Could not clone` site, the `failed` assessment) while keeping `redactSecrets`; verify by tightening the `https://user:super-secret@127.0.0.1:1/no.git` assertion in `server/test/resourceRepositories.test.ts` to require git's reason line, not `Cloning into`, and still no secret

## 2. Authentication failures are recognised

- [x] 2.1 Keep git's full stderr on the error `runGit` throws in `resourceRepositories.ts` and add a classifier returning `{ kind: "auth", scheme, host }` (host from the parsed address, never from stderr) for the HTTPS and SSH patterns in design §2; verify with unit tests fed real git output for each pattern and a non-auth failure that must not classify
- [x] 2.2 Surface the classification on clone (`agent_resource_error`) and on refresh (`failed` assessment) as the optional `auth` field in `shared/src/protocol.ts`, (the lock is read from the credentials snapshot); verify with a server test that clones an HTTPS remote requiring Basic auth (local Basic-auth HTTPS fixture, no credentials) and asserts the `auth` outcome names the host within the time bound (scenario *An authentication failure is named*)

## 3. Credential store and read-only helper

- [x] 3.1 Add the store module (`<agentDir>/git-credentials` in git's credential-store format, normalised `scheme://host[:port]` keys, atomic write, mode `0600`, HTTPS only); verify with unit tests for replace-on-store, port distinction, default-port normalisation, rejected non-HTTPS keys, and file mode on POSIX (scenarios *Storing again replaces*, *Ports distinguish hosts*, *The store is private*, *A stored credential survives a restart*)
- [x] 3.2 Add the read-only helper (design §4): a shell line that answers `get` through `git credential-store --file` and swallows `store`/`erase`; verify through `git credential fill/approve/reject` for hit, miss, missing store, and approve/reject that must leave the file unchanged
- [x] 3.3 Configure the helper only on `resourceRepositories.ts` git processes through `GIT_CONFIG_COUNT`/`KEY`/`VALUE`, appended after the user's own config, with the server's git executable quoted in the helper; verify that a clone from the Basic-auth test server succeeds with a stored credential, that `git.ts` processes do not carry the variables, and that the secret appears in no argv or environment of spawned git (scenarios *A stored credential lets a private repository clone*, *Other git use is unaffected*)
- [x] 3.4 Verify the deployment-first order: with a `GIT_CONFIG_GLOBAL` file whose credential helper answers for the test host, clone and refresh succeed and the store holds no entry for that host afterwards (scenario *Deployment credentials are not captured*)
- [x] 3.5 Verify refresh authenticates through the store after a clone, and that removing the entry makes the next refresh fail as authentication (scenarios *A stored credential keeps refresh working*, *Removing a host* server side)
- [x] 3.6 Store embedded `https://user:secret@host/…` credentials before cloning the credential-free address; skip storing under `credentialsLock`; verify the clone's origin has no credential, the store holds the user, a later refresh authenticates, and no message contains the secret (scenarios *Embedded credentials outlive the clone*, *A failure with a stored credential stays redacted*)
- [x] 3.7 Assert in `server/test/terminalSandbox.test.ts` that the store's path is denied to confined terminals and shells on every platform policy (scenario *A confined shell cannot read the store*)

## 4. Protocol and server handlers

- [x] 4.1 Add `set_git_host_credential` / `remove_git_host_credential` and `gitHosts: { host, username }[]` in the credentials snapshot (`shared/src/protocol.ts`, `server/src/index.ts`), both refused through `credentialsRefused`; verify with a wire test that stores, lists (asserting no message carries the secret), removes, and is refused under `credentialsLock` with the store unchanged (scenarios *The host list carries no secret*, *A locked server refuses*)

## 5. Interface

- [x] 5.1 In `AgentResourceManager.tsx`, show "`<host>` requires authentication" with user name and secret fields on an HTTPS `auth` outcome; submit stores then re-sends the same clone with the kept address and folder; a second failure stays on the prompt saying the credential was refused; an SSH outcome shows the message and a documentation link without fields; a locked outcome says credentials are locked here; verify with component tests for each case (scenarios *Clone asks, stores and retries*, *A wrong secret is said on the prompt*, *SSH is pointed to the documentation*, *A locked server does not prompt*)
- [x] 5.2 Offer the same prompt on a repository row whose refresh failed with an HTTPS `auth` outcome, refreshing again after storing; verify with a component test (scenario *Refresh asks too*)
- [x] 5.3 List Git hosts under Settings → Accounts with user name and a remove action, hidden actions when locked; verify with `SettingsMenu` component tests (scenario *Removing a host* client side, lock display)
- [x] 5.4 Exercise it in the running app with Playwright against a local Basic-auth Git HTTPS server (`server/test/fixtures/gitHttpServer.mjs`): clone without credentials → prompt → wrong secret → refused on prompt → right secret → preview; refresh after removing the host in Settings → prompt again; then a monkey pass (double submit, cancel mid-request, remove the host while a clone is running, switch project during the prompt) reading back the DOM and the store file after each burst; keep the server script under `scripts/probes/`

## 6. Documentation

- [x] 6.1 Add *Git credentials for Agent resources* to `docs/configuration.md` (the prompt, the address form, Settings → Accounts, the lock, deployment-side helpers and SSH consulted first, where the store lives) and replace the "never stores" sentence there; add the persistence note to `docs/docker.md` (`HOME=/home/node` is not a volume; the agent directory is); verify local links and anchors resolve and the documented helper commands run as written

## 7. Integration

- [x] 7.1 Write `openspec/changes/git-host-credentials/scenario-coverage.md` mapping every scenario of the three delta specs to its test, run `npm run check:scenarios`, the server and UI suites, and `openspec validate git-host-credentials --strict`; verify all pass

## Workflow follow-up

- Archive the change from `main` after the PR is merged, never from the feature branch.
