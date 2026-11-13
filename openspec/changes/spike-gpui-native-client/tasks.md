# Tasks

## 1. Validate the spike foundation

- [x] 1.1 Inspect the current WebSocket handshake, authentication, snapshot and prompt/event message shapes; document the Rust client mapping and any protocol blockers in the spike findings.
- [x] 1.2 Select one initial desktop platform and confirm GPUI toolchain/dependency availability with a minimal native window; record the build command and limitations.
- [ ] 1.3 Decide how the prototype receives server endpoint and credentials without putting secrets in argv or logs; verify rejection of unauthenticated connections against the real server.

## 2. Build the minimal GPUI client

- [x] 2.1 Add the experimental Rust/GPUI client target and verify it builds on the selected platform without changing the existing web build.
- [ ] 2.2 Implement connection, initial conversation snapshot, prompt submission, and streamed assistant/tool activity using the existing WebSocket protocol; verify each against a real pi-outpost server and add focused tests for protocol mapping.
- [ ] 2.3 Render connection and startup failures in the native UI; verify refused, unavailable, and interrupted connections produce visible actionable states rather than a blank or stuck view.

## 3. Add the opt-in native launch lifecycle

- [ ] 3.1 Add the dedicated native launch command while preserving default web startup; verify existing CLI launch tests and help output remain correct.
- [ ] 3.2 Start the existing server when needed, wait for its readiness, and launch GPUI without opening a browser; verify the client does not open before the server is usable.
- [ ] 3.3 Track server process ownership and shut down only a process started by the native command; verify a reused server survives client close and an owned server exits on normal client close and launcher interruption.
- [ ] 3.4 Add automated integration tests for launch readiness, startup failure cleanup, owned-child shutdown, reused-server preservation, and unchanged web launch behavior.

## 4. Evaluate and report the spike

- [ ] 4.1 Exercise the real end-to-end conversation in the running native app and verify the rendered conversation and response, not only unit tests.
- [ ] 4.2 Document how to build and run the experimental client, supported platform, known gaps, protocol changes (if any), process/authentication model, and a go/no-go recommendation; verify documented commands against the prototype.
- [ ] 4.3 Run focused native and CLI tests plus relevant type/build checks, and record outcomes and unresolved limitations in the spike findings.
