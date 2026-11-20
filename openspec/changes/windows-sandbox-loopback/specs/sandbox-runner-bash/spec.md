# Spec Delta

## ADDED Requirements

### Requirement: UnderMxcOnWindowsACommandReachesItsOwnLoopback

Under MXC on Windows without `sandbox.allowedHosts`, the agent's shell SHALL run with the host's loopback
open, so a process can connect to a port it listens on and Python's `socket.socketpair()` and asyncio
work. Other services on the machine's loopback then become reachable; the server itself SHALL still
refuse a command that lacks its token.

#### Scenario: OnWindowsPythonAsyncioRunsConfined
- **GIVEN** `bash` confined by MXC on Windows 11 tier 1, no `sandbox.allowedHosts`, and Python installed
- **WHEN** a command runs `python -c "import asyncio; asyncio.run(asyncio.sleep(0)); print('ok')"`
- **THEN** it prints `ok` and exits within seconds

#### Scenario: OnWindowsTheServerRefusesAConfinedCommand
- **GIVEN** the same shell and the server listening on the loopback
- **WHEN** a command opens the server's WebSocket without the token
- **THEN** the socket closes with code 4401 and nothing reaches the agent

### Requirement: TheHostLoopbackCanBeClosed

`sandbox.hostLoopback` MAY be set to `false`; under MXC on Windows the agent's shell SHALL then run with
the host's loopback closed, as before this change. The key SHALL have no effect on other runners and
platforms, and SHALL be refused at load when it is not a boolean.

#### Scenario: AClosedLoopbackKeepsHostServicesOut
- **GIVEN** `sandbox.hostLoopback: false`, `bash` confined by MXC on Windows, and a service listening on the host's loopback
- **WHEN** a command connects to that service
- **THEN** the connection does not succeed

#### Scenario: HostLoopbackMustBeABoolean
- **GIVEN** `sandbox.hostLoopback: "yes"`
- **WHEN** the configuration is loaded
- **THEN** it is refused with a reason naming the key

### Requirement: TheStartupLineStatesTheWindowsLoopback

Under MXC on Windows, the server's startup sandbox line SHALL say whether a command can reach the
machine's loopback services, and, when it cannot (`sandbox.hostLoopback: false` or
`sandbox.allowedHosts`), that Python's asyncio cannot start in the shell.

#### Scenario: TheLineNamesTheAsyncioLimit
- **GIVEN** `bash` confined by MXC on Windows with `sandbox.allowedHosts` set
- **WHEN** the server starts
- **THEN** its sandbox line says loopback services are out of reach and Python's asyncio cannot start
