# Spec Delta

## MODIFIED Requirements

### Requirement: ASandboxRefusalIsNamed

Under MXC on Windows, when a command fails and a host it names falls where the sandbox's own network
policy refuses it, the output SHALL end with a note naming that host, the setting that refuses it, and
that it is not a network failure, whatever the program printed. Where no host can be named but the
output shows a refused connection, the note SHALL say so without a host, and SHALL NOT claim the
Internet is open. A refused connection SHALL NOT offer a file diagnosis.

#### Scenario: ASandboxRefusalIsNamed
- **GIVEN** the agent's PowerShell confined by MXC on Windows 11 tier 1, the private network closed by default
- **WHEN** a command connects to another address of the machine's private subnet, with .NET's own error, and with curl, which prints only that it could not connect
- **THEN** each output ends with the note naming that address and `sandbox.privateNetwork`, and offers no diagnosis; a command that met no refusal gets none

#### Scenario: TheNoHostRefusalNoteDoesNotClaimTheInternetIsOpen
- **GIVEN** the agent's PowerShell confined by MXC on Windows 11 tier 1 without `sandbox.allowedHosts`, on a machine with no route to the Internet (air-gapped) whose own firewall answers WSAEACCES (10013)
- **WHEN** a command's output shows the refused-connection error and names no host the sandbox's policy refuses
- **THEN** the ending note says a connection was refused (WSAEACCES, 10013) without naming the sandbox as the refuser and without claiming the Internet is open — on an air-gapped machine the same error comes from the machine's own firewall; it states that the sandbox does not restrict outbound connections without `sandbox.allowedHosts` (whether the Internet answers is the machine's network, not the sandbox's) and which addresses it does close (the private network unless `sandbox.privateNetwork` is true, the machine's own services when `sandbox.hostLoopback` is false), and says retrying will not help
