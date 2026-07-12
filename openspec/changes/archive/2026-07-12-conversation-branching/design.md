# Design: conversation-branching

## Context

pi's `SessionManager` stores the conversation as a tree of entries (user/assistant messages, tool results, model changes, branch summaries) with a movable *leaf* pointer; every branch ever taken stays in the file. `AgentSession.navigateTree(targetId)` moves that leaf — and its behavior depends on the target's type: for a **user message** (or a `custom_message`) it sets `leaf = target.parentId` and returns the message text as `editorText` (rewind-and-re-edit, the pi TUI's UX); for **any other entry** it sets `leaf = target` (plain checkout). The server previously exposed only user-message targets, which is why the UI could rewind but never return.

`buildTree()` collapses the raw entry tree down to user turns, because those are the points a human recognizes. The reply entries between two user turns are exactly the states we now also want to be able to land on.

## Goals / Non-Goals

**Goals:**
- Make branching legible: the graph shows which path is current and where it forked.
- Make navigation reversible: any turn already answered can be restored in full.
- Let a user rephrase an earlier prompt and branch from it without retyping into the composer.

**Non-Goals:**
- Branch summarization on navigate (`navigateTree`'s `summarize` option) — the SDK generates a label for abandoned branches when asked; we display labels but don't request summarization.
- Deleting or pruning branches (the session file is append-only by design).
- Lane reclamation in the graph (a terminated branch keeps its column). Fine at conversation scale; revisit if sessions accumulate dozens of branches.
- Editing assistant messages, or editing a prompt *without* re-running it.

## Decisions

- **`tipId` on `TreeNode`, computed server-side.** `replyTip(node)` descends through the non-user children answering the turn and returns the last plain `message` entry. Alternatives: sending the whole raw entry tree to the client (leaks entry types the UI has no business interpreting, and the collapse logic would move to the client), or letting the client navigate to "the last entry" of a branch (it doesn't know the entry graph). The tip is `undefined` when the turn has no reply yet, or when the replies fork — an ambiguous target is worse than falling back to the turn.
- **`custom_message` is never a tip.** The SDK treats a `custom_message` target exactly like a user message (leaf = parent, content → editor prefill), so stopping on one would rewind a step short *and* paste an extension's internal message into the user's composer. `replyTip` descends *through* them but only ever returns a `type: "message"` entry.
- **Navigation allowlist = every id the tree advertises** (`treeNavigationTargets(roots)`: each `entryId` plus each `tipId`). Widening the check to "any existing entry" would let a client land on a compaction or label entry; keeping it to user messages was what caused the bug. The set is derived from the same `buildTree()` the client was given, so client and server agree by construction.
- **`edit_prompt` is one server-side operation, not two client calls.** The client sending `navigate_tree` then `prompt` would race (a second client, or the user, could prompt in the window between them). The server does `navigateTree(entryId)` → broadcast snapshot → `handlePrompt(text)`, holding `replacingSession` across the navigation.
- **`prompt` now honors `replacingSession`.** The flag existed but nothing read it on the prompt path: a prompt arriving during `navigateTree`'s async extension hooks would append under the old leaf, and the navigation would then overwrite `agent.state.messages` — silently corrupting a running turn. Editing makes that window routine, so the guard is now load-bearing.
- **`user_entries` carries text, and pairing stops at the first mismatch.** The optimistic `user` echo fires from `preflightResult`, but `AgentSession.prompt()` returns *without appending an entry* when an extension slash command handled the input, when an extension `input` handler returns `handled`, or when a steer was queued and then aborted before delivery. Position-aligned pairing would then shift every earlier bubble onto the previous message's id, and an edit would silently rewind the wrong turn. Comparing text makes drift *fail closed* (bubble loses its id → no edit) instead of failing wrong. The server's own snapshot pairing stays positional: it derives items from `session.messages`, which never contains the phantoms.
- **Graph layout: lane 0 is the current path.** Children *and* roots sort `onPath` first, and the "current" color is reserved for lane 0 (other lanes cycle through the remaining palette) so no dead branch can ever wear the you-are-here color. Sibling roots are branches too — rewinding to the first turn moves the leaf before it, so re-prompting creates a new root.

## Risks / Trade-offs

- [Editing rewinds: the answer currently on screen disappears from the transcript] → that is the point, and it is not destroyed — it moves to its own branch, reachable from the tree; the editor says so before the user commits.
- [An extension vetoes the rewind (`session_before_tree` → cancel) after the client dropped the draft] → the server sends an explicit error; the text is lost, which is why the veto path is reported rather than swallowed.
- [Graph width grows with total branches ever created] → 14px per lane inside a 32rem dropdown; acceptable for conversation-scale trees, documented as a non-goal.
- [Two clients editing concurrently] → serialized by `replacingSession`; the loser gets "Session change already in progress" rather than a corrupted session.

## Open Questions

None blocking. Branch labels are displayed but never requested — wiring the SDK's summarizer into a navigate action is a natural follow-up.
