# Proposal

## Why

The running-app walkthrough of `landstrip-network-allowlist` (task 5.2, in the Docker image) showed
the agent misreading landstrip's own reports. landstrip writes every refusal as a JSON line on
stderr, for example `{"kind":"network","code":"NETWORK_DENIED","state":"info",…}`. `python3 -m venv`
makes a harmless `bind` on `[::1]:0`, so that line was the only output of a command that succeeded.
The agent took it for a failure and redid the venv without pip. MXC prints nothing of the kind. The
same walkthrough found the startup line saying `network only to nothing` for an empty
`sandbox.allowedHosts`, which actually asks about every host. And the confinement requirement still
calls a readable server environment "the known gap of landstrip", which landstrip 0.20 has closed.

## What Changes

- Under landstrip, each refusal line on stderr becomes one line naming the operation and its
  target, saying the sandbox refused it and that the command went on. Other output is unchanged.
- The startup line describes the network the way it behaves: `every host asked about`,
  `network closed`, or `only to <hosts>, other hosts asked about`.
- `AReadableServerEnvironmentIsJudgedByWhatItHolds` stops attributing the gap to landstrip on
  Linux. landstrip 0.19 had it; 0.20 hides the server's process. The behaviour is unchanged.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `sandbox-runner-bash`: two added requirements (landstrip's refusals told in words; the startup
  line's network). `AReadableServerEnvironmentIsJudgedByWhatItHolds` has its wording corrected.

## Impact

- `server/src/confinedBash.ts` (`landstripNote`, `landstripStderr`, `run`'s stderr), and
  `server/src/sandbox.ts` with `server/src/index.ts` (`networkSummary`).
- Tests: `server/test/landstripNotes.test.ts`, `server/test/confinedNetworkLandstrip.test.ts`.
- Stacked on `landstrip-network-allowlist`, whose task list it completes (4.3, 5.2).
