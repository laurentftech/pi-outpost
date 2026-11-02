## Why

A prompt sent while the agent is working is queued: pi holds it and delivers it at the end of the
current assistant turn, before the next model call. Until then nothing has read it, yet pi-outpost
offers no way to correct or withdraw it. The server echoes it as a chat bubble the moment pi accepts
it — appended under the running turn, with no edit action — and repeats its text in a dashed
"steering" box. A typo, a wrong file name or a change of mind has to be answered with a second
steering message.

pi has the primitive: `AgentSession.clearQueue()` (RPC `clear_queue`) takes every queued message back
and returns its text. pi's own terminal uses it for Alt+Up, "return queued messages to the editor".

## What Changes

- **A queued prompt is shown as a pending bubble** below the running turn, with the usual pencil and a
  ✕, instead of an echoed bubble plus the dashed box. It joins the conversation as an ordinary bubble
  when pi delivers it, at the point where the agent reads it.
- **The pencil edits a queued prompt in place.** The server remembers its queue — the text the user
  typed, its images, its order — takes the whole queue back with `clearQueue()`, and queues it again
  with the edited prompt in its place.
- **The ✕ removes a queued prompt**, by the same take-back and re-queue without it.
- **A prompt pi delivered meanwhile is not rewritten.** The edit or removal is refused, the edited text
  goes back to the composer, and the rest of the queue is queued again as it was.
- **Read-only where re-queueing would lose something**: an RPC dialect without `clear_queue` (OMP, Prime
  Agent), or a queue holding a message an extension queued, shows its pending prompts without pencil or ✕.

## Capabilities

### New Capabilities

- `queued-prompts`: how prompts waiting in the agent's queue are shown, edited and removed.

### Modified Capabilities

- `model`: a queued prompt is no longer echoed at acceptance, so it no longer produces a bubble that
  never becomes an entry.
- `conversation-tree`: the transcript edit rule names the queued prompt as outside it.

## Impact

- Protocol (`shared/src/protocol.ts`): `queue` carries the pending entries; new client messages
  `edit_queued_prompt` and `remove_queued_prompt`; a refusal message that returns the text.
- Server: a per-workspace queue tracker (`server/src/queuedPrompts.ts`), `handlePrompt`, both runtimes
  (`clearQueue`, whether the queue is editable).
- UI: `useAgent.ts`, `App.tsx`, `UserMessage.tsx`.
