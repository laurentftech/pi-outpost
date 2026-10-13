## ADDED Requirements

### Requirement: AllowedModelsBindTheSession

When `allowedModels` is set, no turn SHALL run on a model outside it. A session on such a model —
the agent directory's default at start, or after a new, switched or forked session — SHALL be moved
to the first allowed model with usable credentials, without changing the agent directory's default.
A client's `set_model` naming a model outside the list SHALL be refused with an error and change
nothing. When no allowed model can be set, the session SHALL still start, and a prompt SHALL be
refused with an error.

#### Scenario: TheSessionStartsOnAnAllowedModel
- **GIVEN** `allowedModels` naming one model, and an agent directory whose default model is another
- **WHEN** a client is greeted and sends a prompt
- **THEN** the greeting names the allowed model, the turn runs on it, and the agent directory's default is unchanged

#### Scenario: AModelOutsideTheListIsRefused
- **GIVEN** `allowedModels` naming one model
- **WHEN** a client sends `set_model` naming another model of a configured provider
- **THEN** it receives an error, no `model_changed` is sent, and the next turn runs on the allowed model

#### Scenario: ANewSessionStaysOnAnAllowedModel
- **GIVEN** `allowedModels` naming one model, and a default model outside it
- **WHEN** a client starts a new session and sends a prompt
- **THEN** the replaced session's snapshot names the allowed model, and the turn runs on it
