## MODIFIED Requirements

### Requirement: TheDefaultSandboxMayBeTurnedOff

`"sandbox": false` in the configuration file SHALL restore the unsandboxed behaviour: unscoped file tools,
and a shell that is not confined. While a `bash` tool is active, the shell's lock SHALL be shown open, saying
that the sandbox is turned off and suggesting no command; with no `bash` tool, no lock SHALL be shown.

#### Scenario: SandboxFalseRestoresTheOldBehaviour
- **GIVEN** `"sandbox": false` in the configuration
- **WHEN** the agent writes a file outside the working directory
- **THEN** the write succeeds, and the shell's lock is shown open, its description saying the sandbox is turned off, with no suggestion to confine the shell

#### Scenario: SandboxFalseWithoutAShellShowsNoLock
- **GIVEN** `"sandbox": false` and a `tools` allowlist without `bash`
- **WHEN** the interface shows the agent's shell
- **THEN** no lock is shown
