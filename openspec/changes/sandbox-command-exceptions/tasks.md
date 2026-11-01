# Tasks

## 1. Configuration and forbidden targets

- [x] 1.1 Add `sandbox.grants: "ask" | "never"` (default `"ask"`) to `server/src/config.ts`, refuse any other value at startup, and keep Settings from editing it. Verify with config tests: the default, `"never"`, an invalid value stopping startup, and a Settings apply leaving it unchanged.
- [x] 1.2 Add a grant validator in a new `server/src/sandboxGrants.ts`. It resolves directories (through the nearest existing ancestor for one that does not exist), refuses the agent directory and the configuration file (equal, holding or inside them) and `.pi` directories (equal or inside), a drive's root and the home directory itself, and refuses IP literals, `localhost`/`*.localhost`, a trailing dot and wildcards as hosts. It drops hosts already allowed. Verify with unit tests for each `SomeTargetsCanNeverBeGranted` case, a symlink into the agent directory, and Windows paths built with `path.join`/`path.resolve`.
- [x] 1.3 Document `sandbox.grants` in the config reference and in `docs/sandboxing.md`, including the forbidden targets. Verify that the fenced JSON parses and the local links resolve.

## 2. Applying a grant in each runner

- [x] 2.1 Add `grantedRead`, `grantedWrite` and `grantedHosts` to `ConfinedBashOptions`, plus a session-grants provider read at each `exec`, in `server/src/confinedBash.ts`. Verify with a unit test that a launch's policy inputs include the grants and that the next launch without them does not.
- [ ] 2.2 Extend `terminalPolicy` (landstrip), `mxcPosixConfig` (MXC Linux and macOS) and `seatbeltPolicy` with the granted read and write directories. Verify with policy unit tests (read grant readable but not writable, write grant writable), and with the real-runner tests where CI provides the runner (`LANDSTRIP_BIN`, `MXC_LXC_EXEC`, `SEATBELT_EXEC`): `ADirectoryBesideTheRootIsWritableUnderEachRunner` and `AReadGrantDoesNotWrite`.
- [x] 2.3 Extend `mxcTerminalConfig` (MXC Windows): add the grants to `readwritePaths`/`readonlyPaths`; the sibling deny list stays as it is, since the more specific allow wins. Verify with unit tests on the policy, and with a real `wxc-exec.exe` run on Windows 11 where a granted directory beside the root is writable and its siblings stay denied.
- [x] 2.4 Refuse a directory grant under WSLC (`sandbox.bashImage`), naming the fixed mounts, and refuse a host grant without `sandbox.allowedHosts`, saying the network is open. Verify `WslcRefusesADirectoryGrant` and `AnOpenNetworkNeedsNoHostGrant` with unit tests.

## 3. Host grants through the proxy

- [x] 3.1 Give a once-grant a dedicated proxy for `allowedHosts ∪ hosts` that is closed after its launch, and give session grants `sharedEgressProxy(allowedHosts ∪ sessionHosts)`, leaving the base list's proxy unchanged (`server/src/egressProxy.ts`, `confinedBash.ts`). Verify with tests: a granted host relayed, the dedicated proxy closed afterwards, and `AnotherProjectKeepsItsList`. Superseded by 8.1–8.2: a granted host is no longer asked for by the agent; each command gets a proxy of its own that asks on connection.
- [x] 3.2 Prove per runner that a command reaches only its own proxy port and no other loopback port, for MXC Linux, MXC macOS and Seatbelt (MXC Windows is already covered by `TheProxyCannotBeBypassed`). Enable host grants only where that test passes, and refuse them elsewhere with the reason. Verify with the runner tests in their CI jobs.
- [x] 3.3 Change the refusal note so that, with grants enabled, it names `run_with_grant` for the refused host and still names `sandbox.allowedHosts`. With `"never"`, keep today's text. Verify `TheNoteNamesTheGrantRequest` and the existing `AnotherHostIsRefusedWithTheReason` test, updated, in `server/test/`. Superseded by 8.2: with someone to ask, the note gives the user's answer about each host; with no one to ask, today's text.

## 4. The approval round trip

- [x] 4.1 Add `sandbox_grant_request`, `sandbox_grant_response`, `sandbox_grant_resolved`, the pending requests and the active `grants` to the session snapshot in `shared/src/protocol.ts`, separate from `extension_ui_request`. Verify that `tsc --noEmit` passes for every workspace, and with a protocol test that an `extension_ui_response` cannot answer a grant.
- [x] 4.2 Implement the pending grant requests in `server/src/index.ts`: a five-minute timeout, the turn's abort signal, the first answer winning, a broadcast resolution, an immediate refusal with no connected client, cancellation when the session is replaced, and one log line per outcome. Verify with server tests for `NoAnswerIsARefusal`, `NobodyToAskIsARefusal`, `TheFirstAnswerWins`, `ARefusedRequestRunsNothing` and `AGrantLeavesATrace`.
- [x] 4.3 Hold session grants per session and clear them when the session is new, switched, forked or replaced, when sandbox settings are applied, and on restart, never persisting them. Verify `ANewSessionStartsWithoutGrants` with a test that also checks that the configuration file and project settings are byte-identical afterwards.

## 5. The agent's tool

- [x] 5.1 Register `run_with_grant` beside `bash`/`powershell` in `createSandboxedTools` (`server/src/sandbox.ts`) only under a runner, without `bashFrom`, and with grants not `"never"`. It runs sequentially. Its description says the user approves every grant, and its result starts with the grant it ran with. Verify `TheToolComesWithAConfinedShell` and `NoRunnerNoGrantTool` with sandbox tool tests.
- [x] 5.2 Wire the tool through validation (1.2), runner support (2.4, 3.2), the approval round trip (4.2) and the launch with the grant (2.1, 3.1). Verify `AnApprovedCommandRuns` and `AOnceGrantIsBoundToItsCommand` (an identical later command is refused) with a server test through the agent's tools, and `LaterCommandsKeepTheSessionGrant` for a session grant.

## 6. Interface

- [x] 6.1 Add a grant dialog in `ui/src/components/` that shows the command verbatim, each target with its access, the agent's reason labelled as such, a note when a write grant overrides `allowWrite: false`, and the buttons allow once, allow for this session and refuse, with no default on "session". It closes when the request is resolved elsewhere. Verify with component tests for the rendering, each button's response, and closing on `sandbox_grant_resolved`.
- [x] 6.2 Show active session grants on `ConfinementLock` (`🔒 shell confined · N grants`, each listed in the description) without changing the verdict's state. Verify `TheLockNamesItsGrants` and `TheLockReturnsWhenGrantsEnd` with component tests.
- [x] 6.3 Document grants for users in `docs/sandboxing.md` (what can be granted, the scopes, what never can, per-runner support, the audit line) and in the README's sandboxing summary. Verify that the links and anchors resolve and that the examples match the tool's real result text.

## 7. Integration in the running app

- [x] 7.1 Rebuild `web`, then `@pi-outpost/embed`, then `build:e2e-host`, and run the app on Windows 11 with MXC and `powershell.exe`, with `allowedHosts` set. Ask the agent for something that needs an unlisted host and a directory beside the root. Approve once, then for the session, then refuse. Read back the transcript, the files on disk, the server log and the badge in the DOM with Playwright.
- [x] 7.2 Break pass: reload while a dialog is pending, answer from two tabs, abort the turn mid-dialog, switch sessions with a pending request and with session grants active, delete the granted directory between approval and launch, and apply a sandbox settings change while grants are active. After each burst, read back the DOM and the log for stale dialogs, grants surviving their session, or a command run without approval. Report what broke.
- [x] 7.3 Write `openspec/changes/sandbox-command-exceptions/scenario-coverage.md`, mapping every `#### Scenario:` of both deltas (checked with `rg '^#### Scenario:' openspec/changes/sandbox-command-exceptions`) to a test file and test name, read assertion by assertion. Then run `npm run check:scenarios` and `npx openspec validate sandbox-command-exceptions --strict`, and verify both pass.

## 8. Hosts asked about on connection (rework after the running-app campaign)

- [x] 8.1 Give the egress proxy an `ask` hook that holds a connection to an unlisted host until the answer, asks once per host for the proxy's life, and refuses with the answer's reason. Verify with `server/test/egressProxy.test.ts` "a proxy that asks about an unlisted host" (held until answered, one question for two connections, 403 with the reason, listed hosts never asked about).
- [x] 8.2 Give each command a proxy of its own when someone can be asked (`askHost`), for the list and the session's hosts, closed after the command; refuse forbidden hosts without asking; end the output with each answer, and say not to retry a refused host. Verify with `server/test/confinedBash.test.ts` "with someone to ask, …" and, under the real executor, `server/test/confinedNetworkMxc.test.ts` "a connection to an unlisted host, asked about while it waits".
- [x] 8.3 Make `run_with_grant` directory-only, add `kind` (`command` / `connection`) to grant requests, and ask about hosts only on runners that pass the proxy-isolation test (`hostGrantsRefusal`). Verify with `sandboxGrants.test.ts`, `sandboxGrantBroker.test.ts` and `sandboxGrantsServer.test.mjs`.
- [x] 8.4 Show a connection request as such: the host, the running command, no agent reason, "Allow for this command". Verify with `ui/src/components/SandboxGrantDialog.test.tsx` and in the running app (the dialog read back from the DOM, a single `powershell` call, the title fetched).
- [x] 8.5 Rewrite the grants section of `docs/sandboxing.md` and the README rows for the new flow. Verify the anchors resolve and the JSON parses.
- [x] 8.6 Default Windows PowerShell's `Invoke-WebRequest` to `-UseBasicParsing` in the confined shell, where it otherwise fails "not in interactive mode". Verify with `confinedNetworkMxc.test.ts` "PowerShellFetchesThroughTheProxy" (a plain `Invoke-WebRequest` returns 200).
- [x] 8.7 Run the no-hint campaign again in the running app on this design and read the transcripts: nobody asked about a host that was never connected to, one dialog per host per command, a session host not asked again, directory requests still made after a refusal when the user asks for something new.

## Workflow follow-up

- Before the PR: run `check_spec_drift`, add the documentation impact note, and update the changelog with `sandbox.grants: "never"` as the way to keep the previous behaviour.
- Archive the change after review and merge, then verify the archived main specs.
