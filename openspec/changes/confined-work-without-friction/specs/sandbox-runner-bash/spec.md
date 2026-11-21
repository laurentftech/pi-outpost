# Spec Delta

## ADDED Requirements

### Requirement: ACommandGivenNoTimeoutEnds

A confined command given no timeout SHALL be stopped after a default limit long enough for an install
to finish. Its output SHALL then end saying it was stopped at that limit, that a command which keeps
running until stopped needs a timeout of its own, and nothing about the sandbox. A command given its own
timeout SHALL run to it, with no such sentence.

#### Scenario: ACommandGivenNoTimeoutStillEnds
- **GIVEN** a confined shell
- **WHEN** a command that never ends, such as a server, is run with no timeout
- **THEN** it is stopped at the default limit, and its output says so, says a server needs a timeout of its own, and names neither the sandbox nor a diagnosis

### Requirement: TheConfinedShellLeavesTheProjectAsItWas

Under MXC on Windows, what a confined shell writes for itself — PowerShell's module cache among it —
SHALL go to the command's private temporary directory, never to the working directory, which is the
user's project.

#### Scenario: PowerShellLeavesNothingInTheProject
- **GIVEN** a confined Windows PowerShell under MXC on Windows
- **WHEN** a command makes PowerShell look up a name it cannot resolve at once, and runs long enough for its module cache to be written
- **THEN** nothing is left in the command's working directory

### Requirement: ConfinedOutputReachesTheAgentUndamaged

Under MXC on Windows, the output of the programs a confined command runs SHALL reach the agent in the
encoding it is read in: Python's output SHALL be UTF-8, so a message Windows words in the user's
language is not damaged on the way.

#### Scenario: PythonsMessagesComeBackUndamaged
- **GIVEN** a confined shell under MXC on Windows, and a Python whose UTF-8 mode is off
- **WHEN** a script fails with an error Windows words in the user's language
- **THEN** the message reaches the agent with no replacement character
