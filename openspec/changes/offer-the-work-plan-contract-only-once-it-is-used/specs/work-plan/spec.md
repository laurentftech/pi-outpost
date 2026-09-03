## MODIFIED Requirements

### Requirement: Self-describing Work Plan tool contract
The structured Work Plan interface SHALL expose object schemas whose `action` property enumerates the operations that schema carries and whose remaining properties are optional, individually typed, and documented with the actions that use them. Every nested input field, accepted status, and nullable clearing value SHALL be declared. An agent SHALL be able to construct a valid call from the tool name, description, schema, and prompt guidelines without learning required fields from rejected mutations. A refused call SHALL be answered with a diagnosis that names the refused field, and SHALL NOT enumerate the failures of operations the call did not request.

The interface SHALL be published as two tools, described under **The Work Plan contract is split by what an operation needs**. Each SHALL be self-describing on its own terms: an agent reading either SHALL be able to call every action that tool carries, and SHALL be told where the others live. The prompt guidelines that accompany an operation SHALL follow the tool that carries it, so what an agent is told matches what it is currently able to call.
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

### Requirement: The Work Plan contract is split by what an operation needs

The Work Plan interface SHALL be published as two tools. The first SHALL carry the operations
that need nothing to exist first — inspecting, creating, adding, updating, moving and removing
tasks, and clearing the plan — and SHALL be published to every session. The second SHALL carry
the operations that act on tasks that must already exist: whole-plan replacement, dependency
sets, resource sets and evidence collections. It SHALL be published only while the session has
a Work Plan.

The schema is sent on every request of every conversation. The withheld operations are both
the expensive ones — they carry complete plans, evidence records and resource lists — and the
impossible ones, since none of them can be called against a session with no plan. A tool that
cannot be called is one no conversation should be charged for reading.

The task shape accepted at creation SHALL NOT advertise evidence or resource collections;
those are set on tasks that exist, through the second tool. A creation draft that carries them
anyway SHALL still normalise, so a client written against the previous contract keeps working.

Publication SHALL be derived from the persisted plan rather than from separately held state,
and a change SHALL take effect within the turn that causes it: an agent that creates a plan
SHALL be able to record evidence against it without waiting for the next turn.

Each tool SHALL name the other and say what it carries, and an action refused because it
belongs to the other tool SHALL be refused by name, saying where it lives.

Where a runtime cannot change its published toolset — the RPC dialect has no command for it —
that runtime SHALL publish both tools at all times rather than emulate the gating. The
embedded SDK runtime is the supported target for this behaviour.

#### Scenario: A session with no plan publishes only the common operations
- **GIVEN** a session whose workspace holds no Work Plan
- **WHEN** the agent's toolset is composed
- **THEN** the tool carrying creation and task updates is published
- **AND** the tool carrying evidence, resources, dependencies and replacement is not

#### Scenario: Creating a plan publishes the rest within the same turn
- **GIVEN** a session with no Work Plan
- **WHEN** the agent creates one
- **THEN** the second tool is published
- **AND** the agent can record evidence against a task in its next call of that same turn

#### Scenario: A session that already has a plan publishes both
- **GIVEN** a session whose workspace holds a Work Plan
- **WHEN** the session is bound, resumed, switched to, or forked
- **THEN** both tools are published

#### Scenario: Clearing a plan withdraws the extended operations
- **GIVEN** a session publishing both tools
- **WHEN** the plan is cleared
- **THEN** only the tool carrying the common operations remains published

#### Scenario: Every action belongs to exactly one tool
- **WHEN** the published tools are compared against the enumerated Work Plan actions
- **THEN** each action appears in exactly one of them
- **AND** none is absent from both

#### Scenario: An action asked of the wrong tool is refused by name
- **WHEN** an agent asks one tool for an action the other carries
- **THEN** the refusal names the action and the tool that carries it
- **AND** it does not enumerate the requirements of unrelated operations

#### Scenario: Creation no longer advertises evidence, but still accepts it
- **WHEN** an agent inspects the creation task shape
- **THEN** it declares no evidence or resource collection
- **AND** a creation draft that carries them is still normalised into the persisted plan

#### Scenario: A runtime that cannot gate says so rather than pretending
- **GIVEN** a workspace served by the RPC runtime
- **WHEN** the agent's toolset is composed for a session with no plan
- **THEN** both tools are published, as that dialect cannot change its active toolset
