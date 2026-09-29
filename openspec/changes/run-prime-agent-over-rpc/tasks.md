## 1. Start

- [x] 1.1 Confirm against a real Prime Agent 0.9.7 which bootstrap commands exist: `get_tree`, `get_entries`, `get_branch_messages` and `get_available_thinking_levels` answer `Unknown command` without an `id`; `get_fork_messages` answers `{ messages: [] }`.
- [x] 1.2 Fall back from `get_branch_messages` to `get_fork_messages`, keeping `fork` as the fork command (spec: PrimeAgentStartsWithoutATree, NoActiveBranchSourceFailsClosed).
- [x] 1.3 Strip `.sh` when deriving the agent-directory variable (spec: ASourceLauncherReceivesTheAgentDirectory). Verified in the running app: Prime Agent wrote its `auth.json` and sessions into the configured `agentDir`.

## 2. Turns

- [x] 2.1 Relay `session_action_update` as the queue.
- [x] 2.2 Reopen a turn on `auto_retry_start` and re-send the last queue (spec: ARetryKeepsTheTurnRunning).
- [x] 2.3 Close a reopened turn on a failed `auto_retry_end` (spec: ACancelledRetryEndsTheTurn). Found in the running app: Stop left the composer on "working…".

## 3. Running app

- [x] 3.1 Drive pi-outpost against a real Prime Agent with Playwright: startup, a prompt that fails and retries, a prompt sent during the retry (shown as steering), Stop, reload, new session, switch back, tree, fork.
