# Tasks

## 1. A token always

- [x] 1.1 Generate, persist and reuse the token when none is configured: `outpost-token` in the agent directory, mode 0600, exclusive-create so concurrent starts agree; never written or read when `server.token`/`PI_OUTPOST_TOKEN` is set. Verify with unit tests in `server/test/` covering first start, second start, concurrent creation and a configured token (`NoTokenConfigured`, `EnvOverridesConfig`).
- [x] 1.2 Keep the off-loopback refusal on a configured token only: a generated file does not satisfy it. Verify with the existing transport tests plus `RemoteStillRequiresToken` extended to a pre-existing token file.
- [x] 1.3 Require the token on `/ws` regardless of `Origin` (remove the `Origin`-less trust; an authenticated `Origin`-less client keeps the right to restart), and redact `/health` always. Verify with `WsWithoutOriginNeedsTheToken`, `WsWithBadToken` and `HealthRedacted` tests against a real server through the harness.
- [x] 1.4 Print the startup URL with `?token=` and open the browser on it. Verify with a test reading the startup line, and in the running app (Playwright): open the printed URL, check the interface connects without the token screen and the address bar no longer holds the token (`OpenedBrowserIsAuthenticated`).
- [x] 1.5 Make every harness server's token known to its tests — read back from its agent directory, as an operator would, so the generated-token path is the one exercised (an env token would count as configured and stand the DNS-rebinding guard down) — and make `wsUrl()` carry it by default (`null` to omit it); adjust tests that assert token-less behaviour. Verify with `npm test` green on the server suites, and `npm run test:e2e` after giving e2e servers a shared token and the browser a storage state holding it; rebuild `web`, `@pi-outpost/embed` and `build:e2e-host` and check `npm run bench` still serves a working widget.
- [x] 1.6 Check the other in-repo clients (`printMode.ts`, `scripts/npm-install-probe.cjs`, probes, `doctor`) still connect. Verify by running `pi-outpost print` against a token-less configuration and the npm install probe.
- [x] 1.7 Monkey pass on the token flow in the running app: wrong token in the URL, token file deleted while the server runs then restart, two tabs, token screen submitted twice, embed widget with its own token. Verify by reading back the DOM and the WebSocket close codes; report what broke.
- [x] 1.8 Document it: `docs/getting-started.md` (where the token comes from, the printed URL), `docs/configuration.md` (`server.token`, the generated file), `docs/command-line.md`, the development workflow for the Vite UI in `docs/development.md`. Verify links and that each documented command runs as written.

## 2. The loopback under MXC on Windows

- [x] 2.1 Turn the measured probe into a Windows-only test of MXC itself (`socketpair` under today's request hangs; with `hostLoopback: allow` it works and a host listener is reached), so a Windows or MXC change shows up. Verify it passes on Windows 11 tier 1 and is skipped elsewhere.
- [x] 2.2 Add `sandbox.hostLoopback` (boolean, default `true`, refused when not a boolean) and build the MXC Windows request with `ingress: { default: "deny", hostLoopback: "allow" }` when it is true and there is no `allowedHosts`, unchanged otherwise; leave `mxcDiagnosticConfig` alone. Verify with request-building unit tests for the three shapes and `HostLoopbackMustBeABoolean`.
- [x] 2.3 Verify the confined commands for real on Windows 11: asyncio prints `ok` in the agent's shell and in a confined terminal (`OnWindowsPythonAsyncioRunsConfined`, `OnWindowsAsyncioRunsInTheTerminal`); a command opening the server's WebSocket without the token gets 4401 (`OnWindowsTheServerRefusesAConfinedCommand`); with `hostLoopback: false` a host listener is out of reach from both (`AClosedLoopbackKeepsHostServicesOut`, `OnWindowsAClosedLoopbackAlsoClosesTheTerminal`); the generated token is neither in the command's environment nor readable (`GeneratedTokenOutOfTheSandbox`).
- [x] 2.4 State the loopback in the startup sandbox line under MXC on Windows, with the asyncio limit when it is closed or under `allowedHosts`. Verify with `TheLineNamesTheAsyncioLimit` and a test of the open case.
- [ ] 2.5 Exercise it through the agent in the running app on Windows: ask it to run a pytest suite using pytest-asyncio and to `import lancedb` (issue #525's case), then read the session transcript to confirm the commands finished. Verify by the transcript, not a screenshot.
- [x] 2.6 Document it in `docs/sandboxing.md` (Windows 11: what the open loopback reaches, `sandbox.hostLoopback`, the `allowedHosts` limit with microsoft/mxc#1261 and #1731) and `docs/configuration.md`. Verify links and the JSON examples parse.

## 3. Integration

- [ ] 3.1 Write `openspec/changes/windows-sandbox-loopback/scenario-coverage.md` mapping every scenario from `rg '^#### Scenario:' openspec/changes/windows-sandbox-loopback` to its test, all `covered`; run `npm run check:scenarios`, `npm run lint` and `openspec validate windows-sandbox-loopback --strict`.

## Workflow follow-up

- Comment on issue #525 with the outcome and the upstream links once released.
- When Windows fixes intra-container loopback (microsoft/mxc#1261), consider flipping `sandbox.hostLoopback` to `false` by default.
- Archive the change after review.
