# Extension Startup Specification

## Purpose

How a session behaves while its extensions are still starting: a message sent in that window waits
for them, so a rule an extension loads at start applies to the first tool call, and the wait is
shown and can be cancelled.

## Requirements

### Requirement: APromptWaitsForTheExtensions

A message sent while the session's extensions are still starting SHALL NOT run before they have
finished: the server SHALL hold it and run it once they have, extension commands included. The
session's snapshot SHALL say the extensions are still starting, and the client SHALL show a held
message as waiting for them rather than as being sent.

#### Scenario: APromptWaitsForTheExtensions
- **GIVEN** an extension whose `session_start` takes four seconds
- **WHEN** a client sends one of its commands as soon as it is greeted
- **THEN** the greeting says the extensions are still starting, and the command runs only after that `session_start` has finished

#### Scenario: TheHeldMessageSaysWhatItWaitsFor
- **GIVEN** a message has been sent and the extensions are still starting
- **WHEN** the conversation is shown
- **THEN** the message reads as waiting for extensions to start, with a cancel button, not as sending; once they have started it reads as sending

### Requirement: AWaitingPromptCanBeCancelled

A message held for the extensions SHALL be released, unsent, by abort or by the cancel button, and
the client SHALL be told why it was not sent. A start that never ends SHALL NOT hold it for ever.
Cancelling SHALL put the message's text back in the composer, unless the user has typed another
message there since.

#### Scenario: AbortReleasesAWaitingPrompt
- **GIVEN** an extension whose `session_start` never ends, and a message held for it
- **WHEN** the client aborts
- **THEN** an error says the message was not sent because it was waiting for the extensions to finish starting, the message never runs, and nothing is echoed as sent

#### Scenario: CancelGivesTheMessageBack
- **GIVEN** a message shown as waiting for extensions to start, and an empty composer
- **WHEN** the user presses cancel
- **THEN** the client sends abort and the message's text is back in the composer

#### Scenario: CancelKeepsANewerDraft
- **GIVEN** a message shown as waiting for extensions to start, and the user has typed another message in the composer
- **WHEN** the user presses cancel
- **THEN** the client sends abort and the composer keeps what the user typed
