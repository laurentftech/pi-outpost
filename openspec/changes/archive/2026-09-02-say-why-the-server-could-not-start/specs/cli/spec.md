## ADDED Requirements

### Requirement: AFailureToStartIsSaidOutLoud

A server that cannot start SHALL report why in the same voice as every other failure this
binary can have: one line naming what went wrong, and a non-zero exit. This holds wherever
the start fails — no configuration file to be found, a flag that will not parse, or a port
that will not bind. It SHALL NOT exit on an unhandled error, and it SHALL NOT print a stack
trace as its explanation — a stack is where the code was, not what the operator must do.

An address already in use SHALL be named for what it is. The message SHALL carry the host
and port that were refused, and SHALL name the way to move it, so that reading the line is
enough to act on it. Any other reason a bind fails SHALL still produce a readable line
rather than a trace.

The message SHALL survive the console it was printed on, for every one of those failures.
Where the process owns that console — a standalone executable started from a file manager,
which is how the interface is meant to be opened and which has no terminal behind it — the
process SHALL hold it open until the operator dismisses it, because exiting would close the
window and take the only copy of the message with it. Where the console belongs to
something else — a shell, a script, a continuous integration runner — the process SHALL
exit immediately and wait for no one.

A server that starts SHALL be unaffected: nothing added to its output, and nothing to
dismiss.

#### Scenario: ThePortIsAlreadyTaken
- **GIVEN** something is already listening on the host and port the server was asked to bind
- **WHEN** the operator starts the server
- **THEN** it exits non-zero having printed a single line that names that host and port and the flag that moves it
- **AND** no stack trace is printed

#### Scenario: TheBindFailsForSomeOtherReason
- **GIVEN** an address the machine will not let this process bind
- **WHEN** the operator starts the server
- **THEN** it exits non-zero having printed a readable line naming the failure, not a stack trace

#### Scenario: TheMessageOutlivesTheWindow
- **GIVEN** a launch that owns its console, with no terminal behind it
- **WHEN** the server fails to start
- **THEN** the process holds the console open until the operator dismisses it, so the message can be read

#### Scenario: AFailureBeforeListeningIsHeldToo
- **GIVEN** a launch that owns its console
- **WHEN** the start fails before it reaches the port — no configuration file, or a flag that will not parse
- **THEN** the console is held open until the operator dismisses it, exactly as a bind failure is
- **AND** the same launch from a shell exits at once, with the message and no prompt

#### Scenario: NobodyElseIsMadeToWait
- **GIVEN** a launch from a shell, a script, or a continuous integration runner
- **WHEN** the server fails to start
- **THEN** it exits immediately, waiting for no input

#### Scenario: AServerThatStartsIsUnchanged
- **WHEN** the server binds successfully
- **THEN** it prints what it prints today, waits for nothing, and keeps running
