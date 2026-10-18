## ADDED Requirements

### Requirement: AConfinedShellRunsATurnsCommandsInOrder

When a `bashRunner` confines the agent's shell (`bash` or `powershell`), the commands the model asks
for in one message SHALL run one after another, in the order it wrote them, each starting only once
the previous one has ended.

#### Scenario: ATurnsCommandsRunInOrder
- **GIVEN** `bash` confined by a runner
- **WHEN** one message asks for two commands, the first writing a file after a delay and the second reading it
- **THEN** the second starts after the first has ended, and reads the file the first wrote
