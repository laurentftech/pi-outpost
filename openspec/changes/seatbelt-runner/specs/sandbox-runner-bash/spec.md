## ADDED Requirements

### Requirement: OnMacOsSeatbeltMayConfineBash

On macOS, on Apple silicon or Intel, `"seatbelt"` as `sandbox.bashRunner` SHALL name the system's
`/usr/bin/sandbox-exec`, and a path whose file is `sandbox-exec` SHALL name it too. Its commands SHALL
run under a Seatbelt profile pi-outpost writes from the configuration, with the limits of a confined
command elsewhere, and SHALL signal no process outside the command. Elsewhere than macOS the value
SHALL be refused.

#### Scenario: SeatbeltNamesTheSystemRunner
- **GIVEN** a Mac, Intel or Apple silicon
- **WHEN** the configuration names `"seatbelt"` as `sandbox.bashRunner`
- **THEN** it resolves to `/usr/bin/sandbox-exec`, and on Linux or Windows loading the configuration fails naming macOS

#### Scenario: UnderSeatbeltACommandCannotReachOutsideTheRoot
- **GIVEN** `bash` confined by the Seatbelt runner, a file beside the root, an agent directory with a key, and a process of the server's user
- **WHEN** a command reads both files, writes in the root and beside it, and signals that process
- **THEN** both reads fail, only the write in the root lands, the signal is refused and the process lives, and no key is in the command's environment

#### Scenario: UnderSeatbeltGitAnswersQuietly
- **GIVEN** `bash` confined by the Seatbelt runner in a git repository that is its writable root
- **WHEN** a command runs `git status`
- **THEN** git answers, prints no warning about temporary or cache directories, and leaves no new file in the root

### Requirement: UnderSeatbeltTheNetworkFollowsAllowedHosts

Under the Seatbelt runner, the agent's shell SHALL keep an open network, with the host's loopback
closed, without `sandbox.allowedHosts`; with it, it SHALL reach only the listed hosts through the
server's proxy.

#### Scenario: UnderSeatbeltWithoutAnAllowlistTheNetworkIsOpen
- **GIVEN** `bash` confined by the Seatbelt runner and no `sandbox.allowedHosts`
- **WHEN** a command fetches a public host and another service on the loopback
- **THEN** the public host is reached and the loopback service is not

#### Scenario: UnderSeatbeltAnAllowedHostIsReachedAndOthersAreRefused
- **GIVEN** `sandbox.allowedHosts` naming `registry.npmjs.org`, and `bash` confined by the Seatbelt runner
- **WHEN** a command fetches that host, an unlisted host, and that host again ignoring the proxy, and reaches another service on the loopback
- **THEN** only the first succeeds, through the proxy, and the output ends with the note naming the unlisted host
