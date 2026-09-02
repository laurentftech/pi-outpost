## MODIFIED Requirements

### Requirement: StartingOpensTheInterface

However the server was started — from a package runner, from an installed binary, or
from a standalone executable — starting it for a person SHALL open the interface at
the address the server is actually listening on, once it is listening and not before.
Anyone who starts this reads the address off the terminal and pastes it into a
browser; the software can do that itself.

It SHALL be opened in a window of its own — without tabs or an address bar — where
the machine can present one. This is what the interface is: an application that was
launched, not a page that was visited. Where no such window can be presented, it
SHALL open in the default browser, exactly as it does otherwise; the shape of the
window SHALL be overridable from the command line and from configuration, in both
directions.

The address SHALL be the one bound, not the one requested: where the port was chosen
by the operating system, the opened address SHALL be the port it chose.

Whether to open SHALL be decided by whether a browser can be shown at all — a
desktop session exists — and not by whether a terminal is attached: an executable
launched from a file manager has no terminal and is exactly the case that most needs
opening. It SHALL be suppressed where a browser is the wrong answer: no desktop
session, a container or a service, or a server that exists to back an interface
hosted elsewhere. The decision SHALL be overridable in both directions from the
command line and from configuration.

A failure to open SHALL NOT be a failure to start: the server SHALL keep running and
SHALL print the address, which is what the operator would have read anyway. This
SHALL hold for a window of its own exactly as it holds for a browser tab, and failing
to present one SHALL NOT be reported as an error the operator must act on.

#### Scenario: StartingOnADesktopOpensTheInterface
- **GIVEN** a machine with a desktop session
- **WHEN** the operator starts the server
- **THEN** the interface opens, and it is being served by the time the page loads

#### Scenario: ItOpensInAWindowOfItsOwn
- **GIVEN** a machine that can present a window without tabs or an address bar
- **WHEN** the server is started for a person
- **THEN** the interface appears in such a window

#### Scenario: WhereNoOwnWindowIsPossible
- **GIVEN** a machine whose browser cannot present a window of its own
- **WHEN** the server is started for a person
- **THEN** the interface opens in the default browser, as it does today
- **AND** the server reports no error for it

#### Scenario: TheOperatorCanAskForATab
- **WHEN** the operator asks for the interface in the default browser rather than its own window
- **THEN** it opens in the default browser, on a machine that could have presented its own window

#### Scenario: LaunchedWithoutATerminal
- **GIVEN** a standalone executable launched from a file manager, with no terminal attached
- **THEN** the interface still opens — the absence of a terminal is not the absence of a person

#### Scenario: TheOpenedAddressIsTheBoundOne
- **GIVEN** a configuration that lets the operating system choose the port
- **WHEN** the interface is opened
- **THEN** the address it opens is the one the server bound, not the one configured

#### Scenario: NothingOpensWhereNothingCanSeeIt
- **WHEN** the server runs with no desktop session available
- **THEN** nothing is launched, and the address is printed as usual

#### Scenario: TheOperatorCanSaySoEitherWay
- **WHEN** the operator asks for no browser, or asks for one where it would not have opened
- **THEN** the request is honoured

#### Scenario: AFailedOpenIsNotAFailedStart
- **GIVEN** a machine where launching a browser fails
- **WHEN** the server starts
- **THEN** it is running and serving, and the address is printed
