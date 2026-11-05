# Scenario coverage

Scenarios enumerated with `rg '^#### Scenario:' openspec/changes/add-docker-python-deployment`.
OpenLore orient identified CLI/configuration, terminalSandbox, confinementStatus and doctor. Existing relevant behavior
is in `terminal` (confined PTY), `sandbox-runner-bash` (canary, denied credentials) and `cli` (doctor).
Their implementation is unchanged; the new deployment boundary is exercised against the npm app.

| Scenario | Status | Test file and name |
|---|---|---|
| KeepsTheDockerDaemonOutsideTheApp | partial | `deploy/docker/test.mjs`: `KeepsTheDockerDaemonOutsideTheApp` — resolved Compose and inspected container, non-root, capabilities, loopback, no socket. Pending execution. |
| HonorsAnExplicitNetworkRefusal | partial | `deploy/docker/test.mjs`: `HonorsAnExplicitNetworkRefusal` — caller denies network/local binding; actual Python bind/connect remain refused even with operator opt-in. Pending execution. |
| AgentNetworkNeedsOperatorOptIn | partial | `deploy/docker/test.mjs`: `AgentNetworkNeedsOperatorOptIn` — protected operator choice false; actual bind/connect refused despite generated allowNetwork true. Pending execution. |
| UsesPinnedNpmWithNativeBindings | partial | `deploy/docker/test.mjs`: `UsesPinnedNpmWithNativeBindings` — exact npm version and live installed-app PTY. Pending execution. |
| RunsPythonInTheConfinedTerminal | partial | `deploy/docker/test.mjs`: `RunsPythonInTheConfinedTerminal` — real venv/Python writes, host readback, interrupt followed by another command. Pending execution. |
| ProtectsCredentialsAndConfiguration | partial | `deploy/docker/test.mjs`: `ProtectsCredentialsAndConfiguration` — four real refused reads, refused write, secret-free environment/logs. Pending execution. |
| RefusesMissingCredentialsOrUnverifiedConfinement | partial | `deploy/docker/test.mjs`: `RefusesMissingCredentialsOrUnverifiedConfinement` — real failed starts with missing token and missing runner. Pending execution. |
| PreservesTheBrowserTerminal | partial | `deploy/docker/browser.mjs`: `PreservesTheBrowserTerminal` — Python from actual UI and host readback, Ctrl+C, burst tabs and reconnect. Pending execution. |
| PersistsProjectsAndAgentState | partial | `deploy/docker/test.mjs`: `PersistsProjectsAndAgentState` — named-volume config and credential readback after recreation, host project retained. Pending execution. |
