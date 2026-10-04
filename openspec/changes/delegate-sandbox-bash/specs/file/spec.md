# Spec Delta

## ADDED Requirements

### Requirement: AgentWritesStayOutOfPiConfiguration

None of the agent's file-writing tools SHALL write inside a `.pi` directory under the writable zone:
`write`, `edit`, and every tool that writes a file to a path the agent names. This applies at any
depth, including through a symbolic link. Such a write SHALL be refused, with a reason naming the
`.pi` directory as configuration that confines the agent. Reading those files SHALL remain allowed.
The rule SHALL apply only to the part of the path below the writable zone, and SHALL NOT apply to
`.pi-outpost` or any other name. The file browser, acting for the user, is not held to it.

#### Scenario: WriteAndEditRefuseAPiDirectory
- **WHEN** the agent writes `.pi/sandbox.json`, `nested/.pi/settings.json` or `.pi/extensions/x.ts`, or edits `.pi/sandbox.json`
- **THEN** each is refused with the reason, and nothing changes on disk

#### Scenario: ASymlinkIntoPiIsRefused
- **WHEN** the agent writes `innocent/sandbox.json`, where `innocent` links to `.pi`
- **THEN** it is refused

#### Scenario: OtherPathsStayWritable
- **WHEN** the agent writes `src/a.txt`, `.pi-outpost/structured-exchange.json`, `notes.pi` or `api/x.txt`
- **THEN** each is written

#### Scenario: PiConfigurationStaysReadable
- **WHEN** the agent reads `.pi/sandbox.json`
- **THEN** it gets its content

#### Scenario: EveryFileWritingToolIsHeld
- **WHEN** a tool that writes a file — here the table writer — is asked for an output in `.pi`
- **THEN** it is refused with the reason, and no file is written

### Requirement: LoadedSkillsAreReadable

Under a sandbox, the read tools (`read`, `ls`, `grep`, `find`) SHALL also read, and only read, the
directory of each skill the session loaded, wherever it lives: bundled with pi-outpost, installed into
the agent directory, or discovered elsewhere. A directory that is the filesystem root, the home
directory, or one containing the agent directory SHALL NOT be added. No other file outside the
sandbox SHALL become readable.

#### Scenario: LoadedSkillsAreReadable
- **WHEN** the agent reads a bundled skill's `SKILL.md`, a file beside it, and a skill installed into an agent directory outside the project, with a file beside it
- **THEN** each read returns the file's content

#### Scenario: OnlySkillsBecomeReadable
- **WHEN** the agent reads the agent directory's `auth.json`, or a file of pi-outpost's installation outside any skill
- **THEN** each read is refused as outside the sandbox, and no key is returned
