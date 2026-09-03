## MODIFIED Requirements

### Requirement: Self-describing Work Plan tool contract
The structured Work Plan interface SHALL expose a single object schema whose `action` property enumerates every operation and whose remaining properties are optional, individually typed, and documented with the actions that use them. Every nested input field, accepted status, and nullable clearing value SHALL be declared. An agent SHALL be able to construct a valid call from the tool name, description, schema, and prompt guidelines without learning required fields from rejected mutations. A refused call SHALL be answered with a diagnosis that names the refused field, and SHALL NOT enumerate the failures of operations the call did not request.

This contract SHALL be published to a session that has a Work Plan. A session that has none SHALL publish the opener described under **The Work Plan contract is published only to sessions that use it** instead, and the guidelines that accompany the full contract SHALL follow it: what an agent is told about managing a plan SHALL match what it is currently able to call.
#### Scenario: Creation schema declares its complete input
- **WHEN** an agent inspects the Work Plan tool schema
- **THEN** the schema declares the plan title and the recursively nested task shape, including the task dependency list
- **AND** no creation field is hidden behind an unconstrained schema object

#### Scenario: Mutation branches require their own arguments
- **WHEN** an agent inspects any operation-specific argument
- **THEN** the schema declares which actions require it
- **AND** it is not presented as a requirement of unrelated actions

#### Scenario: A refusal names the field it refuses
- **WHEN** a call carries a property the requested action does not accept
- **THEN** the diagnosis names that property and its path within the call
- **AND** it does not report the requirements of operations the call did not request

#### Scenario: Clearing optional values is discoverable
- **WHEN** an operation can clear an optional parent, description, or status reason
- **THEN** its schema declares the accepted JSON `null` value for that field

#### Scenario: The tool carries a worked example
- **WHEN** the agent's prompt is composed
- **THEN** the Work Plan tool contributes guidelines containing a literal, valid creation call with dependencies and one level of subtasks

## ADDED Requirements

### Requirement: The Work Plan contract is published only to sessions that use it

The full Work Plan tool contract SHALL be published to a session only while that session has
a Work Plan. A session without one SHALL publish an opener instead: one tool that creates a
plan and nothing else, whose description says when an agent should reach for it.

The schema is sent on every request of every conversation, and most conversations never open
a plan. The opener is what keeps the capability reachable without charging every trivial
exchange for the whole contract.

Activation SHALL be derived from the persisted plan rather than from separately held state,
and SHALL take effect within the turn that opens the plan: an agent that decides mid-turn
that the work needs a plan SHALL be able to open it and then use the contract, without
waiting for the next turn or being told twice.

Where a runtime cannot change its published toolset — the RPC dialect has no command for it
— that runtime SHALL publish the full contract at all times rather than emulate the gating.
The embedded SDK runtime is the supported target for this behaviour.

#### Scenario: A session with no plan publishes the opener
- **GIVEN** a session whose workspace holds no Work Plan
- **WHEN** the agent's toolset is composed
- **THEN** the opener is published and the full Work Plan contract is not

#### Scenario: Opening a plan publishes the contract within the same turn
- **GIVEN** a session with no Work Plan
- **WHEN** the agent calls the opener
- **THEN** the plan is created
- **AND** the full contract is available to the agent's next call in that same turn

#### Scenario: A session that already has a plan starts with the contract
- **GIVEN** a session whose workspace holds a Work Plan
- **WHEN** the session is bound, resumed, switched to, or forked
- **THEN** the full contract is published and the opener is not

#### Scenario: Clearing a plan returns the session to the opener
- **GIVEN** a session publishing the full contract
- **WHEN** the plan is cleared
- **THEN** the opener is published again and the full contract is not

#### Scenario: The guidance follows the published tools
- **WHEN** the agent's prompt is composed for a session with no plan
- **THEN** it carries the sentence that says when to open one
- **AND** it does not carry the guidance for operations the session cannot call

#### Scenario: A runtime that cannot gate says so rather than pretending
- **GIVEN** a workspace served by the RPC runtime
- **WHEN** the agent's toolset is composed for a session with no plan
- **THEN** the full contract is published, as that dialect cannot change its active toolset
