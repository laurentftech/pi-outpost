## ADDED Requirements

### Requirement: AResourceInventoryDoesNotHoldStartup

Starting a project SHALL NOT wait for its resource inventory longer than a short grace. When the
inventory lands after the project's clients were greeted, the server SHALL send it to them as an
inventory message.

#### Scenario: ASlowInventoryDoesNotHoldStartup
- **GIVEN** a skill whose repository git answers about only after ten seconds
- **WHEN** the server starts and a client connects
- **THEN** the client is greeted while that question is still pending, and the inventory listing the repository arrives afterwards

### Requirement: TheInventoryAsksGitOncePerRepository

The inventory SHALL ask git where a repository is at most once per repository, and SHALL NOT ask it
for a resource with no `.git` entry above it. Git's answer SHALL still decide: a `.git` git refuses
leaves its resources outside any repository, and a nested repository owns what it holds.

#### Scenario: OneQuestionPerRepository
- **GIVEN** eight skills in one repository and six outside every repository
- **WHEN** the inventory is built
- **THEN** git is asked where the repository is once, the repository lists its eight skills, and the six are not backed by a Git repository
