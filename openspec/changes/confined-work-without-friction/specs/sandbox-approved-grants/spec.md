# Spec Delta

## MODIFIED Requirements

### Requirement: SomeTargetsCanNeverBeGranted

The server SHALL refuse, before asking anyone, a directory that is, holds or lies inside the agent
directory or the configuration file, that is or lies inside a `.pi` directory, or that is a drive's root
or the home directory itself. A directory the sandbox already gives SHALL NOT be refused for holding a
protected target: a grant adds nothing to it, and the request runs as without one. It SHALL refuse a
connection to a host given as an IP literal or a loopback name without asking. The check SHALL resolve
symlinks first, and the refusal SHALL name the target and why.

#### Scenario: TheAgentDirectoryIsNeverGranted
- **GIVEN** a confined shell
- **WHEN** the agent requests read access to the agent directory, to a directory holding it, or to a symlink pointing into it
- **THEN** the request is refused without a dialog, naming the target and why

#### Scenario: BroadOrLocalTargetsAreRefused
- **GIVEN** a confined shell
- **WHEN** the agent requests the home directory itself, a drive's root or a `.pi` directory, or a command connects to `127.0.0.1` or `localhost`
- **THEN** each is refused without a dialog, naming the target and why

#### Scenario: AskingForWhatTheSandboxGivesRunsWithoutAGrant
- **GIVEN** a project whose root holds its configuration file, as `pi-outpost init` writes it
- **WHEN** the agent requests read or write access to the project's root
- **THEN** nothing is granted and nothing is refused: the sandbox gives it already
- **AND** a request for the configuration file itself, or for a folder above the root holding it, is still refused

## ADDED Requirements

### Requirement: ARefusalHoldsForTheRequest

Once the user refuses a grant, the same grant SHALL NOT be put to the user again while the agent answers
the same message: it SHALL be refused at once, telling the agent not to ask again and to tell the user
what it blocked. A narrower request (reading inside a folder refused for writing) is a question of its
own. A new message from the user is a new request, which may ask again. Every refusal the agent is told
— by the user, by a rule, or for a target never granted — SHALL say not to ask again.

#### Scenario: ARefusalIsNotAskedAgainInTheSameRequest
- **GIVEN** the user refused a grant to write a folder beside the project
- **WHEN** the agent asks the same grant again while answering the same message, then asks to read a folder inside it
- **THEN** the repeat is refused without a dialog, telling the agent not to ask again, and only the narrower read is put to the user
