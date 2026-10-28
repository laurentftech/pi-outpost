# Design

## 1. An extension, not a server feature
`/btw` is a Pi extension command that pi-outpost bundles. It is not a WebSocket message of its own.
That gives it, for free, everything a command already has: the composer offers it, the operator's
`blockedCommands` / `allowedCommands` apply to it, and it runs in both runtimes. The SDK's
`summarize.ts` example has the same shape: read the branch, serialise it, call
`ctx.modelRegistry.complete`. A server feature would need a new message, a new panel and a second
path into the model registry for each runtime.

It is registered like `codemode` and `mcp`, as a named, replaceable factory. A person who installs
their own `btw` extension gets theirs. Unlike those, it is not dropped under `noExtensions`: that
switch isolates the session from extension *code found on disk*, and this is pi-outpost's own,
like its tools.

## 2. What the answer is made from
The command reads `ctx.sessionManager.getBranch()` when it runs. Mid-turn, that already holds the
turn's user message, every finished assistant message with its tool calls, and every tool result.
The only thing missing is the assistant message still streaming, which is at most a few seconds
behind what the person sees.

The branch is serialised as text (user text, assistant text, one line per tool call with its
arguments, tool results cut to their first 2 000 characters), most recent last. It is then cut
from the front to fit the budget, 60 000 characters by default. An entry that the cut would split
is dropped whole, and the text says that earlier conversation was left out. A compaction summary
on the branch is kept as the first section. The question goes in its own user message after the
conversation, never inside it.

## 3. The call
- The model is `ctx.model`, the one the session is on. With no model, or none with credentials
  (`ctx.modelRegistry.hasConfiguredAuth`), the panel says so and no call is made.
- No tools, so the answer can only use what the conversation shows. The system prompt says that,
  and says to answer briefly in the language of the question.
- `cacheRetention: "none"` and a fresh `sessionId` (`uuidv7()`), so that the call shares no cache
  entry or provider session with the turn. Reusing the turn's prompt cache would need the turn's
  exact system prompt, tools and messages, which is a later optimisation and not this change.
- An `AbortController` per question, independent of `ctx.signal`. Aborting the turn does not cancel
  the side question, and the side question never aborts the turn. A new `/btw` aborts the one still
  pending, and so does `/btw` with no question.

## 4. Where it is shown
`ctx.ui.custom()` returns `undefined` in pi-outpost, because a TUI component has nowhere to
render. The answer goes in a string-array widget, key `btw`, placed `aboveEditor`. Its lines are
the question, `…` while waiting, then the answer or the failure, then a hint that `/btw` closes
it. The widget is plain text, so markdown is shown as written. `ctx.ui.notify` is not used: a long
answer does not fit a toast. `ctx.ui.editor` is not used either: it would count as a pending
dialog and badge the project as waiting on the person.

A failure (no credentials, a provider error) is written in the panel. It does not go to the
conversation's error banner, which reads as the agent's own failure.

A widget is not replayed to a client that connects later, and it is not cleared when the session
changes. The command clears it on `session_start` (a new or switched conversation), so that an
answer about one conversation is never shown under another.

## 5. The echo of a handled command
Both runtimes report acceptance through `onAccepted(true)`, and the server then broadcasts a
`user` message with the text. For a command that an extension handled, nothing was saved and
nothing will run, so that bubble is a ghost: it is gone on reload, and for `/btw` it is the
question shown as if it had been asked of the agent. The SDK distinguishes the cases:
`preflightResult("handled" | "queued" | "started")` in-process, `data.disposition` over RPC. The
runtimes pass the disposition through, and the server echoes `queued` and `started` only. In the
RPC runtime a `handled` prompt also leaves `streaming` as it was. Today it sets it to `true`, which
sends the next prompt as a steer while nothing runs.
