# Tasks

## 1. Lift the gate for the proven runners

- [x] 1.1 Make `hostGrantsRefusal` (`server/src/sandboxGrants.ts`) return nothing for MXC (Windows, Linux, macOS) and Seatbelt and keep its refusal for any other runner kind; update its doc comment to name the proof. Verify with `server/test/sandboxGrants.test.ts`: the gate test and the `asksAboutHosts` test now expect `lxc-exec`, `mxc-exec-mac` and `sandbox-exec` to ask, landstrip still refused (scenario *AnUnprovenRunnerAsksNothingAboutHosts* for the refusal side)

## 2. The question under each POSIX runner, in CI

- [x] 2.1 Add to `server/test/sandboxGrantsReal.test.ts`, for MXC on Linux, MXC on macOS and Seatbelt, the question end to end: a shared list proxy, `askHost` playing the user, two connections to `example.com` — allowed once (both 200, asked once, the allow note) and refused (no 200, the refusal and do-not-retry notes); skip when offline. Verify locally under Seatbelt (`SEATBELT_EXEC=/usr/bin/sandbox-exec`) and in the Docker image of `scripts/mxc-linux/test.sh` (scenarios *APosixRunnerAsksAboutAnUnlistedHost*, *APosixRunnerAppliesARefusal*)
- [x] 2.2 Tag the existing isolation proof `another session's proxy under …` with the scenario *AnotherCommandsProxyIsNoWayOut*, and verify it still passes locally under Seatbelt and in the MXC Linux image (Debian), then in the Rocky 9 probe image
- [x] 2.3 Add a wire test (style of `server/test/sandboxGrantsServer.test.mjs`: scripted provider, real server, a client answering the `connection` request) with `bashRunner` set from `SEATBELT_EXEC`, `MXC_MAC_EXEC` or `MXC_LXC_EXEC` and `sandbox.allowedHosts`; skip where none is named. Add it to `scripts/mxc-macos/test.sh` and the `scripts/mxc-linux/Dockerfile` test list. Verify: the grant request arrives with kind `connection` and the host, approving makes the tool result show the fetch succeeded and the allow note, and the server log has the audit line

## 3. Documentation

- [x] 3.1 Update `docs/sandboxing.md`: the runner table (hosts asked about on connection under MXC on Windows, Linux and Apple-silicon macOS, and Seatbelt), the "Without someone to ask" paragraph, and a note that internal pages must be named by host, not IP. Verify the anchors resolve and the JSON examples parse

## 4. Running app

- [x] 4.1 On this Mac under Seatbelt with the bench host page: a scripted agent runs `curl` to an unlisted host; read back the dialog from the DOM, allow for this command, read the transcript's note; then refuse on a second run; then a monkey pass (answer twice, refresh the page while the dialog is open, abort the turn while it waits). Keep the scripts under `scripts/probes/`
- [x] 4.2 In the Rocky 9 image under Bubblewrap with the server's port published, the same flow driven from the browser on the host. Extend `scripts/probes/mxc-linux-rocky/` with the server start script

## 5. Integration

- [x] 5.1 Write `openspec/changes/host-questions-on-posix-runners/scenario-coverage.md` for every scenario of the delta spec, run `node scripts/check-scenario-coverage.mjs --change host-questions-on-posix-runners`, the server suite, and `openspec validate host-questions-on-posix-runners --strict`; verify all pass

## Workflow follow-up

- Archive the change from `main` after the PR is merged, never from the feature branch.
