# Spec Delta

## MODIFIED Requirements

### Requirement: EachRunnerAppliesAGrantOrSaysItCannot

A directory grant SHALL be applied by every runner that confines the agent's shell, except bash in a WSLC
container, where the request SHALL be refused naming that reason. Hosts SHALL be asked about only on a
runner where a command is shown to reach no other command's proxy: MXC on Windows, Linux and macOS,
Seatbelt, and landstrip on Linux. Elsewhere, and without `sandbox.allowedHosts`, nobody SHALL be asked
about a host.

#### Scenario: ADirectoryBesideTheRootIsWritableUnderEachRunner
- **GIVEN** a runner among landstrip, MXC (Windows, Linux, macOS) and Seatbelt, and a directory beside the root
- **WHEN** a command writes in it with an approved read-write grant
- **THEN** the write succeeds, and the same command without the grant is refused

#### Scenario: AReadGrantDoesNotWrite
- **GIVEN** an approved read grant of a directory beside the root
- **WHEN** the command reads a file there and then tries to write one
- **THEN** the read succeeds and the write is refused

#### Scenario: WslcRefusesADirectoryGrant
- **GIVEN** bash in a WSLC container (`sandbox.bashImage`)
- **WHEN** the agent requests a directory grant
- **THEN** it is refused without a dialog, saying that the container's mounts are fixed when it starts

#### Scenario: AnUnprovenRunnerAsksNothingAboutHosts
- **GIVEN** `sandbox.allowedHosts` under a runner not shown to keep a command off other commands' proxies
- **WHEN** a command connects to a host the list does not name
- **THEN** it is refused at once, nobody is asked, and the note says to add the host to the list

#### Scenario: APosixRunnerAsksAboutAnUnlistedHost
- **GIVEN** `sandbox.allowedHosts` under MXC on Linux, MXC on macOS, Seatbelt or landstrip on Linux, with someone to ask
- **WHEN** a command connects twice to a host the list does not name and the user allows it for this command
- **THEN** both connections succeed, the user was asked once, and the output ends with a note that the user allowed the host for this command

#### Scenario: APosixRunnerAppliesARefusal
- **GIVEN** the same shell
- **WHEN** a command connects to a host the list does not name and the user refuses
- **THEN** the connection fails, and the output ends with a note saying the user refused the host and not to retry it

#### Scenario: AnotherCommandsProxyIsNoWayOut
- **GIVEN** a command confined under MXC on Linux, MXC on macOS, Seatbelt or landstrip on Linux with a proxy of its own
- **WHEN** it connects to another command's proxy by its port
- **THEN** the connection does not reach that proxy
