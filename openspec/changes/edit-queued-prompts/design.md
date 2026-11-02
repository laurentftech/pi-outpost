## Context

While a turn runs, the server sends every prompt to pi as a steer (`streamingBehavior: "steer"`, both
runtimes). pi expands it (input handlers, `/skill:…`, prompt templates), pushes the expanded text on
its display queue, and emits `queue_update`. When it delivers a queued message it removes the first
entry with the same text (`indexOf` on `message_start` of a user message) and emits `queue_update`
again. An abort does not empty the queue: what is left goes out with the next run.

`clearQueue()` empties both queues and returns the *expanded* texts. It returns no images, and no
handle per message: there is no API to remove one message.

## Decisions

### The server keeps the queue; pi stays the authority on what is in it

`QueuedPrompts` (one per workspace) holds an ordered list of entries:
`{ id, kind, piText, text, promptText, images, owned }`. `text` is what the user typed and sees,
`promptText` what was sent (mentions made absolute), `piText` pi's expanded string.

It never guesses: it is fed pi's own `queue` events and reconciles them per kind. An entry whose
`piText` is no longer in pi's list was delivered — pi only removes on delivery or on a clear. A new
string is matched to the oldest *expectation* the server registered before sending a prompt while
the turn ran; one with no expectation is *foreign* (an extension's `sendUserMessage`). An expectation
whose prompt pi did not queue (handled, started, refused) is dropped at acceptance.

Rejected: matching the queued text against what the user typed — pi stores the expanded text, so a
`/skill:` prompt never matches.

### Delivery, not acceptance, puts the bubble in the conversation

A queued prompt is no longer echoed when pi accepts it. The tracker reports each owned entry it sees
delivered, and the server broadcasts its `user` bubble then, with the original text and images. The
bubble lands where the agent read it, and a steer aborted before delivery no longer leaves a bubble
that never becomes an entry. A prompt pi did not report as queued is echoed at acceptance, as before.

### Edit and remove = take everything back, queue it again

`clearQueue()` is the only way to change pi's queue, so an edit or a removal takes the whole queue
back and queues it again, in order and in its own queue (steering or follow-up), with the stored
`promptText` and images — the edited entry with its new text, the removed one left out. It is queued
with pi's `steer()` / `followUp()` (RPC `steer` / `follow_up`), not `prompt()`: those queue whether
or not a turn runs, so editing a prompt left pending by an abort never sends it. Re-queued prompts
are expanded again from what the user typed, so a `/skill:` prompt is the same prompt; extension
`input` handlers see it a second time, which is the cost of having no per-message API.

While the queue is taken back the tracker is suspended: pi's `queue_update` with empty lists is the
clear, not a delivery. Whatever `clearQueue()` did *not* return was delivered just before it, and is
reported as delivered. If the target is among those, the operation is refused, the edited text goes
back to the initiating client's composer, and the rest is queued again unchanged.

If the turn ended between the take-back and the re-queue, the re-queued prompts wait in the queue,
shown pending, and go with the next prompt — as anything left queued after an abort does.

Edits, removals and prompts sent during a turn are serialised per workspace, so two clients' edits,
or a prompt typed during an edit, cannot interleave with a re-queue.

### Send the queue now

After a stop, pi keeps its queue but runs nothing until a new prompt arrives: the pending
bubbles had no way out without typing a message to carry them. And mid-turn, a steer waits for
the end of the step — the model's reply and the tools it called — which can be long.

pi has no public "continue" (`Agent.continue()` drains the queue but is not on `AgentSession` nor
in RPC), so `send_queue_now` uses the same primitives as an edit: stop a running turn and wait
until idle, take the queue back, queue all but the first again as steers, and send the first as
a prompt. A run polls the steering queue as it starts (`agent-loop.js`), so every queued prompt
goes out in the new turn's first request, in order.

Stopping abandons the step in progress: a partial reply stays in the session as aborted and is
never replayed to the model (`transformMessages` skips aborted replies), and a running tool is
killed. Completed steps stay. The interface says so before it happens, inline — a native
`confirm()` returns false, silently, in a sandboxed embed without `allow-modals`.

### Read-only when a re-queue would lose something

Pencil and ✕ are offered only when the runtime can clear its queue (embedded; RPC with standard pi,
which has `clear_queue` — not OMP or Prime Agent) and every entry is owned. A foreign entry would be
re-queued as bare text, losing its images and its origin, so a queue holding one is read-only.

## Risks

- **Duplicate texts.** Two identical queued prompts are told apart by order, as pi does.
- **An extension queuing while a prompt of ours is in flight.** An expectation is matched only by an
  entry of the same queue, preferring one whose text pi kept as sent; so an extension's follow-up is
  never taken for our steer (a test drives exactly that). An extension's *steer* with a different text,
  landing in that window, can still be taken for ours; ours then arrives unmatched, is foreign, and the
  queue turns read-only — it fails closed.
- **An input handler that consumes the prompt on re-queue.** The entry disappears; that is what the
  handler decided for that text.
- **openlore `record_decision` was not available** (its `orient` timed out in this environment); the
  decisions are recorded here.
