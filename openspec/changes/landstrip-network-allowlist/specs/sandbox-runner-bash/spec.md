# Spec Delta

## MODIFIED Requirements

### Requirement: AnAllowlistNeedsMxcWithoutAnImage

`sandbox.allowedHosts` SHALL be refused at load, with a reason naming the key and what it needs, unless
the `bashRunner` is MXC without a `bashImage`, Seatbelt, or landstrip on Linux: no other backend
enforces it here.

#### Scenario: AnAllowlistNeedsMxcWithoutAnImage
- **GIVEN** `sandbox.allowedHosts` with no runner, with landstrip as `bashRunner` on Windows, or with `bashImage`
- **WHEN** the configuration is loaded
- **THEN** it is refused with a reason naming the key and what it needs

#### Scenario: AnAllowlistIsKeptUnderLandstripOnLinux
- **GIVEN** `sandbox.allowedHosts` naming `Registry.npmjs.org`, and landstrip as `bashRunner` on Linux
- **WHEN** the configuration is loaded
- **THEN** it is kept, lower-cased, and the configuration loads

## ADDED Requirements

### Requirement: UnderLandstripOnLinuxTheNetworkFollowsAllowedHosts

Under landstrip on Linux, the agent's shell SHALL keep the network it has today without
`sandbox.allowedHosts`. With it, the shell SHALL reach only the listed hosts, through the server's proxy.
Direct IP traffic SHALL be denied, and so SHALL every loopback port but its proxy's, whatever loopback
address it is reached on.

#### Scenario: UnderLandstripWithoutAnAllowlistTheNetworkIsOpen
- **GIVEN** `bash` confined by the real landstrip runner on Linux and no `sandbox.allowedHosts`
- **WHEN** a command fetches a public host
- **THEN** the host is reached and no proxy variable is set in the command's environment

#### Scenario: UnderLandstripAnAllowedHostIsReachedAndOthersAreRefused
- **GIVEN** `sandbox.allowedHosts` naming `registry.npmjs.org`, and `bash` confined by the real landstrip runner on Linux
- **WHEN** a command fetches that host, an unlisted host, and that host again ignoring the proxy, and reaches another service on the loopback
- **THEN** only the first succeeds, through the proxy, and the output ends with the note naming the unlisted host

#### Scenario: UnderLandstripNoOtherLoopbackAddressReachesAService
- **GIVEN** the same shell, and a service listening on the host's loopback on a port other than the proxy's
- **WHEN** a command connects to that service at `127.0.0.1`, at another `127.x` address and at `::1`, and opens a listening socket
- **THEN** every connection fails without the service's answer, and the listening socket is refused
