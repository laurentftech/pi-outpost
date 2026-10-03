## MODIFIED Requirements

### Requirement: PrimeAgentRunsOverRpc

The RPC runtime SHALL start against a Pi-derived agent that exposes neither `get_tree` nor
`get_branch_messages` but answers `get_fork_messages`, projecting those entries as one linear active
branch and forking with `fork`. When none of the three exists, startup SHALL fail closed.

In a dialect whose `agent_end` is terminal, a turn SHALL remain running while the child retries
after that `agent_end`, and SHALL end when the child reports the retry cancelled. The child's queue
SHALL be shown whether it is reported as `queue_update` or `session_action_update`.

A prompt that Prime Agent refuses because an abort suspended its queued input SHALL be resent once
with `streamingBehavior`, which Prime Agent 0.9.7 requires to resume; any other refusal SHALL be
reported unchanged.

The agent directory SHALL reach an agent started through a `.sh` launcher under the variable its
own name derives.

#### Scenario: PrimeAgentStartsWithoutATree
- **GIVEN** a child without `get_tree` or `get_branch_messages` that answers `get_fork_messages`
- **WHEN** pi-outpost starts in RPC mode
- **THEN** the runtime is ready with those entries as its active branch, and a fork is sent as `fork`

#### Scenario: NoActiveBranchSourceFailsClosed
- **GIVEN** a child answering none of `get_tree`, `get_branch_messages` and `get_fork_messages`
- **WHEN** pi-outpost starts in RPC mode
- **THEN** startup fails, naming the missing command

#### Scenario: ARetryKeepsTheTurnRunning
- **GIVEN** a Prime Agent turn whose attempt ended with `agent_end` while a prompt was queued
- **WHEN** the child reports `auto_retry_start`
- **THEN** clients see the turn running again with the child's queue, and a new prompt is sent as a steer

#### Scenario: ACancelledRetryEndsTheTurn
- **GIVEN** a Prime Agent turn reopened by a retry
- **WHEN** the user aborts and the child reports `auto_retry_end` with `success: false` and no `agent_end`
- **THEN** the turn ends

#### Scenario: APromptAfterAnAbortResumesThePrimeQueue
- **GIVEN** a Prime Agent session whose queued input an abort has suspended
- **WHEN** the user sends a message and the plain `prompt` is refused as suspended
- **THEN** the same message is resent once with `streamingBehavior`, accepted, and later prompts go out plain

#### Scenario: OnlyTheSuspendedRefusalIsResent
- **GIVEN** a child that refuses a `prompt` for any other reason
- **WHEN** the user sends a message
- **THEN** the refusal is reported and the prompt is not resent

#### Scenario: ASourceLauncherReceivesTheAgentDirectory
- **GIVEN** the executable `prime-agent.sh`
- **WHEN** the child's environment is built
- **THEN** it carries `PRIME_AGENT_CODING_AGENT_DIR` as well as `PI_CODING_AGENT_DIR`
