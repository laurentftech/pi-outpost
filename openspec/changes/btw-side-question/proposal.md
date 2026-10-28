# A side question while the agent works

## Why
A long turn leaves the person waiting with nothing to ask. Typing "where are you at?" in the
composer steers the agent: the question lands in its next request, can turn it from what it was
doing, and stays in the conversation for good. A side session does not help either. It starts
empty and knows nothing of the work it was opened beside.

Claude Code answers this with `/btw`: a question about the conversation, answered from the
conversation, while the agent works, and forgotten afterwards. Pi's SDK already makes the core of
it possible. An extension command runs before a prompt is queued, even mid-turn
(`AgentSession.prompt` calls `_tryExecuteExtensionCommand` before it looks at `isStreaming`). Each
message, tool call and tool result is in the session as soon as it ends (`message_end` →
`sessionManager.appendMessage`). And `ctx.modelRegistry.complete` makes a model call that is not
a turn.

## What Changes
- pi-outpost ships a `btw` extension: `/btw <question>` answers the question from what the
  conversation holds so far, with the session's model and no tools, while any turn goes on
  undisturbed.
- The question and its answer are kept out of the conversation. They are not saved in the
  session, not seen by the agent, and not shown as a message. They appear in a panel above the
  composer, which `/btw` with no question closes.
- A command that an extension handled is no longer echoed as the person's message, in either
  runtime. Today it is shown, then lost on reload because Pi never saved it. In the RPC runtime it
  also marks the session busy when no turn started.

## Impact
- New `server/src/btwExtension.ts`, registered in the embedded runtime's `extensionFactories`
  (`server/src/index.ts`) and loaded with pi-outpost's own tools in the RPC child
  (`server/src/piOutpostTools.ts`).
- `server/src/embeddedRuntime.ts` and `server/src/rpcRuntime.ts`: tell a handled prompt from an
  accepted one (`preflightResult("handled")`, RPC `data.disposition`).
- `server/src/index.ts`: no user bubble for a handled prompt.
- No protocol change. The panel is an extension widget (`setWidget`), which the client already
  renders.
- Documentation: `README.md` and `docs/how-to.md` gain `/btw`.
