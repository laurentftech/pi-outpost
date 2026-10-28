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
- `ctx.modelRegistry.streamSimple(…).result()`, not `complete`: `complete` goes straight to the
  provider and fails on a virtual (routed) model, which `streamSimple` resolves as the agent loop
  does.
- The handler starts the request and returns at once. The SDK awaits a command before it reports
  the prompt as handled, and over RPC that report is the `prompt` command's response: a handler
  that waited for the model would hold the prompt, and the RPC command, for as long as the model
  takes.
- An `AbortController` per question, independent of `ctx.signal`. Aborting the turn does not cancel
  the side question, and the side question never aborts the turn. A new `/btw` aborts the one still
  pending, and so does `/btw` with no question.

## 4. Where it is shown
`ctx.ui.custom()` returns `undefined` in pi-outpost, because a TUI component has nowhere to
render. The answer goes in a string-array widget, key `btw`, placed `aboveEditor`. Its first line
says it is a side answer, not part of the conversation, so that an open panel is not read as a
mode the composer has switched into. Then come the open panel's earlier exchanges, oldest first,
each a `› ` question line, its answer and a blank line; then the latest question, `Answering…`
while waiting, then the answer or the failure. The widget is plain text, so markdown is shown as
written.

The client pins the title, so that it stays in view while the rest scrolls, and brings the latest
`› ` line to the top of the scrolling region each time the lines change: the newest answer is read
from its start, and the earlier ones are one scroll, or ↑, away. It does not take focus from the
composer to do so.

The client gives the `btw` widget a close control (×). It does not hide the widget itself: it sends
`/btw` alone, so that closing goes through the command like the keyboard path, cancels a waiting
question, forgets the thread and clears the panel in every client. No protocol change is needed,
and an extension widget stays the extension's to show and to clear.

A widget is bounded to 20% of the window and scrolls inside, or a long answer pushes the composer
off the screen. It takes focus on a click or Tab, so the arrow and page keys scroll it. They are
not taken from the composer, where they move the caret and walk the history. `ctx.ui.notify` is not used: a long
answer does not fit a toast. `ctx.ui.editor` is not used either: it would count as a pending
dialog and badge the project as waiting on the person.

A failure (no credentials, a provider error) is written in the panel. It does not go to the
conversation's error banner, which reads as the agent's own failure.

A widget is not replayed to a client that connects later, and it is not cleared when the session
changes. The command clears it on `session_start` (a new or switched conversation), so that an
answer about one conversation is never shown under another.

## 4b. Follow-ups
The extension keeps the open panel's answered questions and their answers in memory, per session.
The next side question carries them after the conversation, in an `<earlier_side_questions>`
section of the same message, then the new question in its own message. They are text in a user
message, not assistant messages, so no provider sees a fabricated assistant turn. The thread is
kept whole up to half the budget, oldest exchanges dropped first, and the conversation gets the
rest.

A failed question, or one replaced before its answer, does not join the thread. Closing the panel
(× or `/btw` alone), `session_start` and `session_shutdown` forget it. The thread is not saved: a
server restart forgets it, as it already forgets the panel.

A message without `/btw` always goes to the agent. Sending plain text to the side thread while the
panel is open was rejected: it would be a hidden mode, and a message meant for the agent could be
lost to it.

## 5. The echo of a handled command
Both runtimes report acceptance through `onAccepted(true)`, and the server then broadcasts a
`user` message with the text. For a command that an extension handled, nothing was saved and
nothing will run, so that bubble is a ghost: it is gone on reload, and for `/btw` it is the
question shown as if it had been asked of the agent. The SDK distinguishes the cases:
`preflightResult("handled" | "queued" | "started")` in-process, `data.disposition` over RPC. The
runtimes pass the disposition through, and the server echoes `queued` and `started` only. In the
RPC runtime a `handled` prompt also leaves `streaming` as it was. Today it sets it to `true`, which
sends the next prompt as a steer while nothing runs.

The client shows a sent prompt as a placeholder until its echo arrives. It shows none for a prompt
naming an extension command, since no echo would ever replace it.
