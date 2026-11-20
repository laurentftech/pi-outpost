# Spec Delta

## ADDED Requirements

### Requirement: UnderMxcOnWindowsTheTerminalReachesItsOwnLoopback

A terminal confined by MXC on Windows SHALL follow `sandbox.hostLoopback` as the agent's shell does: the
host's loopback open unless it is `false`, so Python's asyncio starts in the terminal. The server SHALL
still refuse the terminal's processes without its token.

#### Scenario: OnWindowsAsyncioRunsInTheTerminal
- **GIVEN** a terminal confined by MXC tier 1 on Windows, `sandbox.hostLoopback` unset, and Python installed
- **WHEN** the user runs `python -c "import asyncio; asyncio.run(asyncio.sleep(0)); print('ok')"`
- **THEN** it prints `ok`

#### Scenario: OnWindowsAClosedLoopbackAlsoClosesTheTerminal
- **GIVEN** the same terminal with `sandbox.hostLoopback: false` and a service listening on the host's loopback
- **WHEN** the user connects to that service from the terminal
- **THEN** the connection does not succeed
