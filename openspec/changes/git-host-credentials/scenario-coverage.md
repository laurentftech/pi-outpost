# Scenario coverage — git-host-credentials

The git side is real everywhere it matters: `server/test/fixtures/gitHttpServer.mjs` serves a bare
repository through `git http-backend` behind HTTPS Basic auth (a test certificate trusted through
`GIT_SSL_CAINFO`), and the tests shut the developer's own git configuration out
(`GIT_CONFIG_GLOBAL`, `GIT_CONFIG_NOSYSTEM`) so a keychain helper cannot make one pass for the wrong
reason. `server/test/gitHostCredentialsWire.test.mjs` drives the real server over the WebSocket;
`server/test/gitHostCredentials.test.ts` drives the store, the helper and `ResourceRepositoryService`;
`ui/src/components/GitHostCredentialPrompt.test.tsx` mounts the real `AgentResourceManager`. The whole
flow was also driven in the running widget (`scripts/probes/git-host-credentials/serve.mts`).

## Capability: `git` (4 scenarios, modified)

| Scenario | Coverage | Assertion evidence |
| --- | --- | --- |
| ATimedOutCommandNamesItsLimit | covered | Unchanged: `server/test/git-failure-message.test.ts` — "ATimedOutCommandNamesItsLimit: …" |
| AMissingGitIsNamed | covered | Unchanged: `server/test/git-failure-message.test.ts` — "AMissingGitIsNamed: …" |
| GitsOwnWordsAreKept | covered | `server/test/git-failure-message.test.ts` — "GitsOwnWordsAreKept: git's reason line is the error, whatever the line endings" (`fatal: bad revision` out of CRLF output with a `hint:` after it); "an error: line is a reason too…"; "without fatal: or error:, the last line that is not a hint is the reason"; "a single line is kept as it is" |
| AProgressLineIsNotTheReason | covered | `server/test/git-failure-message.test.ts` — "AProgressLineIsNotTheReason: …": `Cloning into …` then `fatal: could not read Username …`, LF and CRLF, yields the `fatal:` line (fails on the old first-line rule); `server/test/resourceRepositories.test.ts` — "reports a resource-empty clone…": the clone message matches `Could not clone https://***@127.0.0.1:1/no.git: fatal: ` and not `Cloning into` |

## Capability: `agent-resource-management` (3 scenarios, modified)

| Scenario | Coverage | Assertion evidence |
| --- | --- | --- |
| A repository needing credentials fails instead of waiting | covered | `server/test/resourceRepositories.test.ts` — "reports a resource-empty clone…": an authenticated address fails within 10 s, no secret in the message; "bounds multi-repository refresh concurrency…": every git process has `GIT_TERMINAL_PROMPT=0`, empty askpass, `SSH_ASKPASS_REQUIRE=never`; `server/test/gitHostCredentials.test.ts` — "An authentication failure is named…" fails against a real 401 host within 20 s |
| Configured git authentication still works | covered | `server/test/gitHostCredentials.test.ts` — "Deployment credentials are not captured…": a `GIT_CONFIG_GLOBAL` credential helper answers for the host; clone and refresh succeed (`current`) and the store holds nothing of it |
| An authentication failure is named | covered | `server/test/gitHostCredentials.test.ts` — "An authentication failure is named: host and authentication, not git's progress line, within the bound": `auth` is `{ scheme: "https", host: "https://127.0.0.1:<port>" }`, the message says `<host> requires authentication`, no `Cloning into`; "an embedded wrong secret is named as authentication and never echoed"; `server/test/gitHostCredentialsWire.test.mjs` — the same `auth` on the client's `agent_resource_error` |

## Capability: `git-host-credentials` (18 scenarios, new)

| Scenario | Coverage | Assertion evidence |
| --- | --- | --- |
| A stored credential survives a restart | covered | `server/test/gitHostCredentialsWire.test.mjs` — "A stored credential survives a restart…": the file written by one server, given to a fresh one at `.pi-agent/git-credentials`, is listed in its `hello` and authenticates a clone |
| Ports distinguish hosts | covered | `server/test/gitHostCredentials.test.ts` — "Ports distinguish hosts…": stored for `:8447`, `git credential fill` through the helper gets nothing for the default port and the secret for `:8447`; host-key unit tests |
| Storing again replaces | covered | `server/test/gitHostCredentials.test.ts` — "Storing again replaces…": one entry, the newer user and secret returned by git |
| The store is private | covered | `server/test/gitHostCredentials.test.ts` — "The store is private: mode 0600, even over a file that was looser" (POSIX; skipped on Windows, which has no mode bits) |
| The host list carries no secret | covered | `server/test/gitHostCredentialsWire.test.mjs` — "clone fails as authentication…": `credentials_changed.gitHosts` is `[{ host, username }]`, and no message received by either client, nor the server log, contains the secret; `ui/src/components/GitHostCredentialPrompt.test.tsx` — "Removing a host: …" shows host and user name only |
| A failure with a stored credential stays redacted | covered | `server/test/gitHostCredentials.test.ts` — "Embedded credentials outlive the clone…": with a stale secret stored, the refresh fails with `auth` and the assessment JSON does not contain the secret |
| A stored credential lets a private repository clone | covered | `server/test/gitHostCredentials.test.ts` — "A stored credential lets a private repository clone…": the preview lists the `demo` skill; no argv or environment of any spawned git contains the secret or the store path |
| A stored credential keeps refresh working | covered | `server/test/gitHostCredentials.test.ts` — "A stored credential keeps refresh working…": after the clone, `refresh` is `current` |
| Deployment credentials are not captured | covered | `server/test/gitHostCredentials.test.ts` — "Deployment credentials are not captured…": a wrong credential sits in our store and the deployment's helper a right one; clone and refresh succeed (so ours was asked last), and the store still holds only `mallory`, nothing of `alice`/`right`; "git's approve (store) and reject (erase) leave the file as it was" |
| Other git use is unaffected | covered | `server/test/gitHostCredentials.test.ts` — "A stored credential lets a private repository clone…": after the clone, `process.env` (inherited by `git.ts` and the terminal) holds neither `PI_OUTPOST_GIT_CREDENTIALS` nor a `credential-store` helper; the helper environment is built only in `resourceRepositories.ts` `runGit` |
| A confined shell cannot read the store | covered | `server/test/terminalSandbox.test.ts` — "A confined shell cannot read the store…": the store path is inside the agent directory and under a denied path for the Linux and Windows terminal policies and the MXC Linux configuration |
| Clone asks, stores and retries | covered | `ui/src/components/GitHostCredentialPrompt.test.tsx` — "Clone asks, stores and retries…": the prompt names the host, the credential is sent with the host key, the clone is not retried on submit but once the server says `saved`, with the same address and folder; `server/test/gitHostCredentialsWire.test.mjs` — "clone fails as authentication…": refused clone → `set_git_host_credential` → the same clone reaches `agent_resource_preview` |
| A wrong secret is said on the prompt | covered | `ui/src/components/GitHostCredentialPrompt.test.tsx` — "A wrong secret is said on the prompt…": after the retry comes back refused the prompt says `refused this user name or secret`, keeps the user name, clears the secret, keeps address and folder; "a check started by hand after a retry does not blame the credential typed earlier" |
| Refresh asks too | covered | `ui/src/components/GitHostCredentialPrompt.test.tsx` — "Refresh asks too…": the row with a failed `auth` assessment prompts, stores, then calls `onRefresh("repo-demo")`; server side "A stored credential keeps refresh working…" (failed assessment carries `auth`) |
| SSH is pointed to the documentation | covered | `ui/src/components/GitHostCredentialPrompt.test.tsx` — "SSH is pointed to the documentation…": host named, link to `#git-credentials-for-agent-resources`, no fields; `server/test/gitHostCredentials.test.ts` — "SSH publickey refusal is classified as SSH…" |
| Embedded credentials outlive the clone | covered | `server/test/gitHostCredentials.test.ts` — "Embedded credentials outlive the clone…": `origin` is the address without credentials, `.git/config` has no secret, the store holds `alice`, a later refresh is `current`; "under the credentials lock an embedded credential is used for the clone and not stored" |
| Removing a host | covered | `server/test/gitHostCredentials.test.ts` — "A stored credential keeps refresh working, and removing it turns refresh into an authentication failure"; `server/test/gitHostCredentialsWire.test.mjs` — "removing a host empties the list for every client" (file no longer holds it); `ui/src/components/GitHostCredentialPrompt.test.tsx` — "Removing a host: …" |
| A locked server refuses | covered | `server/test/gitHostCredentialsWire.test.mjs` — "A locked server refuses…": set and remove both answered `ok: false` with the lock reason, no store file created; `ui/src/components/GitHostCredentialPrompt.test.tsx` — "a locked server lists hosts without a remove action" |
| A locked server does not prompt | covered | `ui/src/components/GitHostCredentialPrompt.test.tsx` — "A locked server does not prompt…": host named, `Credentials are locked on this server`, no secret field |
