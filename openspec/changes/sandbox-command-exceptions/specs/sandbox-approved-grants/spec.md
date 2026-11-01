# Spec Delta

## Purpose

Lets the user widen the agent's confined shell, for one command or for one session, by approving in the
interface a narrow grant (a host a running command connects to, or a directory the agent asks for)
without editing the configuration and without ever opening what confinement exists to protect.

## ADDED Requirements

### Requirement: AConnectionToAnUnlistedHostWaitsForTheUser

Under `sandbox.allowedHosts`, on a runner that takes host questions, and with `sandbox.grants` not
`"never"`, a connection from the agent's shell to a host the list does not name SHALL wait while the
user is asked, showing the host and the running command. Allowed, it SHALL go through, and so SHALL
every later connection of that command to that host. The agent SHALL play no part in the question.

#### Scenario: AConnectionToAnUnlistedHostWaitsForTheUser
- **GIVEN** a confined shell whose `sandbox.allowedHosts` does not list `example.com`
- **WHEN** a command fetches `https://example.com/`, and the user allows it for this command while the connection waits
- **THEN** the fetch succeeds, the host was asked about once however many connections the command opened, and the command's output ends with a note that the user allowed `example.com` for this command

#### Scenario: ARefusedConnectionFailsAndSaysWhy
- **GIVEN** the same shell
- **WHEN** a command fetches `https://example.com/` and the user refuses
- **THEN** the connection is refused with a response naming the user's refusal, and the command's output ends with a note saying so and not to retry it for this request

#### Scenario: ACommandThatNeverConnectsAsksNothing
- **GIVEN** the same shell
- **WHEN** a command hands a URL to the desktop instead of connecting (`Start-Process 'https://example.com'`)
- **THEN** nobody is asked, and the command stays refused by the sandbox

### Requirement: AConfinedShellMayRequestADirectory

When the agent's shell is confined by a runner and `sandbox.grants` is not `"never"`, the agent SHALL be
offered a tool that runs one command with one or more directories beyond the sandbox, each read or
read-write, and a reason. The tool SHALL NOT take hosts. Without a runner, with bash handed to an
extension, or with `sandbox.grants: "never"`, the tool SHALL NOT be offered.

#### Scenario: TheToolComesWithAConfinedShell
- **GIVEN** `sandbox.bashRunner` set, `allowBash` on, and `sandbox.grants` absent
- **WHEN** a session starts
- **THEN** the agent is offered the grant tool beside its confined shell tool, and its description says that the user must approve each grant

#### Scenario: NoRunnerNoGrantTool
- **GIVEN** no `sandbox.bashRunner`, or `sandbox.bashFrom` set, or `sandbox.grants: "never"`
- **WHEN** a session starts
- **THEN** the grant tool is not offered

### Requirement: OnlyTheUserGrants

A grant SHALL take effect only once a user approves it in the interface. The interface SHALL show the
command, every host and directory with its access, and, for a directory, the agent's reason. It SHALL
offer allow for this command, allow for this session, and refuse. A refusal, a dismissal, an aborted
turn, five minutes without an answer, or no connected client SHALL each refuse, and the result SHALL
say which.

#### Scenario: AnApprovedCommandRuns
- **GIVEN** a confined shell and a directory beside the root
- **WHEN** the agent requests to run a command writing in that directory with a write grant, and the user clicks allow once
- **THEN** the command runs with the directory writable, and its result records the grant

#### Scenario: ARefusedRequestRunsNothing
- **GIVEN** the same request
- **WHEN** the user clicks refuse
- **THEN** the command does not run, and the tool result says the user refused

#### Scenario: NoAnswerIsARefusal
- **GIVEN** a pending grant request
- **WHEN** five minutes pass without an answer, or the user aborts the turn
- **THEN** the request is refused, nothing it asked for is granted, and the dialog closes in every client

#### Scenario: NobodyToAskIsARefusal
- **GIVEN** no client connected to the workspace
- **WHEN** a grant is asked for
- **THEN** it is refused at once, saying that no one was there to approve it

#### Scenario: TheFirstAnswerWins
- **GIVEN** two clients showing the same pending request
- **WHEN** one approves and the other then refuses
- **THEN** the first answer decides, and the dialog closes in both

### Requirement: AOnceGrantIsBoundToItsCommand

A grant allowed for one command SHALL apply to that command's launch only, and to no other command,
including an identical command the agent runs afterwards.

#### Scenario: TheNextCommandIsConfinedAsBefore
- **GIVEN** a command that ran with a directory or a host allowed for it alone
- **WHEN** the agent then runs the same command again with its ordinary shell tool
- **THEN** the directory is out of reach and the host is asked about again, as before the grant

### Requirement: ASessionGrantLastsForTheSessionOnly

A session grant SHALL apply to the command it was asked for and to every later command of the agent's
shell in the same session. It SHALL end when that session ends or is replaced, when the project's
sandbox settings change, or when the server restarts. It SHALL never be written to the configuration or
to the project's settings.

#### Scenario: LaterCommandsKeepTheSessionGrant
- **GIVEN** a session grant of read-write access to a directory beside the root, or of a host
- **WHEN** the agent later writes in that directory, or connects to that host, with its ordinary shell tool
- **THEN** it succeeds without asking

#### Scenario: ANewSessionStartsWithoutGrants
- **GIVEN** a session grant in one session
- **WHEN** the user starts a new session, switches to another one, applies a sandbox settings change, or restarts the server
- **THEN** the grant no longer applies, and the configuration file and project settings are unchanged

### Requirement: SomeTargetsCanNeverBeGranted

The server SHALL refuse, before asking anyone, a directory that is, holds or lies inside the agent
directory or the configuration file, that is or lies inside a `.pi` directory, or that is a drive's root
or the home directory itself. It SHALL refuse a connection to a host given as an IP literal or a loopback
name without asking. The check SHALL resolve symlinks first, and the refusal SHALL name the target and why.

#### Scenario: TheAgentDirectoryIsNeverGranted
- **GIVEN** a confined shell
- **WHEN** the agent requests read access to the agent directory, to a directory holding it, or to a symlink pointing into it
- **THEN** the request is refused without a dialog, naming the target and why

#### Scenario: BroadOrLocalTargetsAreRefused
- **GIVEN** a confined shell
- **WHEN** the agent requests the home directory itself, a drive's root or a `.pi` directory, or a command connects to `127.0.0.1` or `localhost`
- **THEN** each is refused without a dialog, naming the target and why

### Requirement: EachRunnerAppliesAGrantOrSaysItCannot

A directory grant SHALL be applied by every runner that confines the agent's shell, except bash in a WSLC
container, where the request SHALL be refused naming that reason. Hosts SHALL be asked about only on a
runner where a command is shown to reach no other command's proxy. Elsewhere, and without
`sandbox.allowedHosts`, nobody SHALL be asked about a host.

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
- **GIVEN** `sandbox.allowedHosts` under MXC on Linux or macOS, or Seatbelt
- **WHEN** a command connects to a host the list does not name
- **THEN** it is refused at once, nobody is asked, and the note says to add the host to the list

### Requirement: AGrantDoesNotWidenOtherCommands

Each command of the agent's shell SHALL have a proxy of its own when hosts may be asked about, so that a
host allowed for one command, or for one session, is never reachable from another command, session,
project, or the terminal panel, including those sharing its host list.

#### Scenario: AnotherProjectKeepsItsList
- **GIVEN** two projects with the same `sandbox.allowedHosts`, and a session grant of `example.com` in the first
- **WHEN** a command in the second project connects to `example.com`
- **THEN** it is asked about, or refused, there, as if no grant existed, and a command cannot reach another command's proxy

### Requirement: GrantsAreAudited

The server SHALL log every grant request with its outcome, command, targets, scope and reason. A command
run with a grant, or whose connections were asked about, SHALL say so in its result.

#### Scenario: AGrantLeavesATrace
- **GIVEN** a grant request, by the agent or by a connection
- **WHEN** it is approved, refused, or expires
- **THEN** the server log has one line naming the outcome, the command, each target, the scope and the reason, and the command's result names the grant or the answer about each host

### Requirement: TheBadgeShowsActiveSessionGrants

While session grants are active, the shell's confinement badge SHALL say how many there are and its
description SHALL list each one. The canary's verdict SHALL stay as it was observed, and the badge SHALL
return to its plain form when the grants end.

#### Scenario: TheLockNamesItsGrants
- **GIVEN** a verified shell and one session grant of `example.com`
- **WHEN** the interface shows the shell's badge
- **THEN** it reads as confined with one grant, and its description lists `example.com` for this session alongside the canary's refusals

#### Scenario: TheLockReturnsWhenGrantsEnd
- **GIVEN** the same badge
- **WHEN** the user starts a new session
- **THEN** the badge reads as confined, without grants
