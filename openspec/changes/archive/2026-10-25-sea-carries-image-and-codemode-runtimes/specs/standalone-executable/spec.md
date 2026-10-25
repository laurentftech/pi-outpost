## ADDED Requirements

### Requirement: TheAgentsToolsWorkInsideTheExecutable

Inside the standalone executable, with nothing installed and no file beside it, the agent SHALL read an image and pass it to the model as an image, and SHALL run a codemode script, as it does from an installed package. A build whose bundled SDK no longer loads these the way the build expects SHALL fail rather than produce an executable without them.

#### Scenario: AnImageReadInTheExecutableReachesTheModel
- **GIVEN** the executable's bundle, run from a directory with no `node_modules` and no file beside it
- **WHEN** the agent reads a PNG with `read`
- **THEN** the result holds the image itself, not "[Image omitted …]", and the model's request carries it

#### Scenario: ACodemodeScriptRunsInTheExecutable
- **GIVEN** the executable's bundle, run from a directory with no `node_modules` and no file beside it
- **WHEN** the agent runs the codemode script `return 6 * 7`
- **THEN** the script completes and its output is `42`
