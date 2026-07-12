# Proposal: conversation-branching

## Why

Sessions branch — pi keeps every abandoned path in the same session file — but the UI barely admitted it. The tree dropdown was an indented list where the shape of the branching was invisible, and, worse, *going back was a one-way door*: navigating to a past user turn rewinds to **before** it (the SDK hands the message text back as composer prefill and the reply vanishes), so there was no way to return to a state you had just left except through the session list. Meanwhile the obvious way to explore an alternative — rephrase the question you already asked — required retyping it into the composer, which appended a *new* turn instead of branching from the old one.

This change was implemented and shipped ahead of its spec (commit `0da961b`); the artifacts here document the behavior that now exists and pin the invariants the code review surfaced.

## What Changes

- **Git-style conversation tree**: the tree dropdown renders as a git-log graph — one colored rail per branch (the current path always on lane 0, in the reserved "current" color), fork points curving out to their branch's rail, chips for branch count / current turn / SDK branch labels, a turn-and-branch-point header, and a search box matching message text *and* labels.
- **Restoring a state, not just rewinding to it**: every turn now advertises the entry id of its reply tip (`TreeNode.tipId`). Clicking a tree row navigates to that tip, which restores the exchange in full (reply included, composer empty). The old rewind-to-before-the-message behavior stays available as a secondary `↺ redo` action. The server's navigation allowlist widens from "user messages only" to "every entry id the tree advertises" (turns + their tips).
- **Editing a past prompt branches the conversation**: user bubbles carry their session entry id and gain an inline editor. Re-sending a modified prompt rewinds to just before that message and asks again, so the new answer becomes a sibling branch while the original exchange stays reachable in the tree. **BREAKING** for nothing — additive on the wire.
- **Safe bubble↔entry pairing**: a new `user_entries` server message carries `{entryId, text}` pairs. The optimistic user echo and the persisted entries are *not* 1:1 (an extension slash command, or a steer aborted before delivery, echoes a bubble that never becomes an entry), so the client pairs from the end and stops at the first text mismatch — an unpaired bubble loses its id and its edit affordance rather than silently targeting the wrong turn.
- **Prompts are refused while a session change is in flight**: one landing mid-navigation would append under the old leaf and then have its run's message state overwritten by the navigation.

## Capabilities

### New Capabilities

- `conversation-tree`: the branch graph, its navigation targets (turn vs reply tip), and the edit/rewind/fork actions it exposes.

### Modified Capabilities

- `model`: `ClientMessage` gains `edit_prompt`; `ServerMessage` gains `user_entries`; `ChatItem` user items gain `entryId`; `TreeNode` gains `tipId`. `ConvertHistoryToItems` gains the user-entry-id argument.
- `api`: the WebSocket contract for tree navigation and prompt editing (validation, guards, error paths).

## Impact

- `shared/src/protocol.ts`: `TreeNode.tipId`, `ChatItem` user `entryId`, `edit_prompt` client message, `user_entries` server message.
- `server/src/index.ts`: `replyTip`/`treeNavigationTargets` in `buildTree`, widened `navigateTree` allowlist, `branchUserEntries()`, `editPrompt()`, `user_entries` + `tree` broadcast after each turn, `replacingSession` guard on `prompt`.
- `server/src/convert.ts`: `historyToItems(messages, streaming, userEntryIds)` — positional right-align (sound: `session.messages` never contains the phantom echoes).
- `web/src/useAgent.ts`: `user_entries` reducer case (text-verified pairing), `editPrompt` action.
- `web/src/components/UserMessage.tsx` (new): the editable bubble.
- `web/src/components/TreeMenu.tsx`: full graph rewrite.
- `web/src/App.tsx`: bubble wiring.
- No config, no migration, no persistence change — the SDK's session file already stored all of this.
