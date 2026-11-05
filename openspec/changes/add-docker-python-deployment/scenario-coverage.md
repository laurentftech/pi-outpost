# Scenario coverage

Scenarios enumerated with `rg '^#### Scenario:' openspec/changes/add-docker-python-deployment`.
OpenLore orient identified CLI/configuration, terminalSandbox, confinementStatus and doctor. Existing relevant behavior
is in `terminal` (confined PTY), `sandbox-runner-bash` (canary, denied credentials) and `cli` (doctor).
Their implementation is unchanged; the new deployment boundary is exercised against the npm app.

| Scenario | Status | Test file and name |
|---|---|---|
| KeepsTheDockerDaemonOutsideTheApp | covered | `deploy/docker/test.mjs`: `KeepsTheDockerDaemonOutsideTheApp` — resolved Compose and inspected container, non-root, capabilities, loopback, no socket. |
| HonorsAnExplicitNetworkRefusal | covered | `deploy/docker/test.mjs`: `HonorsAnExplicitNetworkRefusal` — caller denies network/local binding; actual Python bind/connect remain refused even with operator opt-in. |
| AgentNetworkNeedsOperatorOptIn | covered | `deploy/docker/test.mjs`: `AgentNetworkNeedsOperatorOptIn` — protected operator choice false; actual bind/connect refused despite generated allowNetwork true. |
| UsesPinnedNpmWithNativeBindings | covered | `deploy/docker/test.mjs`: `UsesPinnedNpmWithNativeBindings` — exact npm version and live installed-app PTY. |
| RunsPythonInTheConfinedTerminal | covered | `deploy/docker/test.mjs`: `RunsPythonInTheConfinedTerminal` — real venv/Python writes, host readback, interrupt followed by another command, and opted-in Python HTTP server fetched through a published host-loopback port. |
| ProtectsCredentialsAndConfiguration | covered | `deploy/docker/test.mjs`: `ProtectsCredentialsAndConfiguration` — five real refused reads, refused write, secret-free environment/logs. |
| RefusesMissingCredentialsOrUnverifiedConfinement | covered | `deploy/docker/test.mjs`: `RefusesMissingCredentialsOrUnverifiedConfinement` — real failed starts with missing token and missing runner. |
| PreservesTheBrowserTerminal | covered | `deploy/docker/browser.mjs`: `PreservesTheBrowserTerminal` — Python from actual UI and host readback, Ctrl+C, burst tabs and reconnect. |
| PersistsProjectsAndAgentState | covered | `deploy/docker/test.mjs`: `PersistsProjectsAndAgentState` — named-volume config and credential readback after recreation, host project retained. |

Executed successfully on 2026-11-05 against commit `80af4c4e0e0972bf40ee725cc73b6b11ee48fcab`, Ubuntu x64 with AppArmor 4: [Docker and running-app browser checks](https://github.com/laurentftech/pi-outpost/actions/runs/42027849126). Both confinement canaries verified; all nine scenarios passed, including refused starts, five protected reads, bind/connect refusals, UI lifecycle and actual HTTP readback after explicit operator network opt-in.
