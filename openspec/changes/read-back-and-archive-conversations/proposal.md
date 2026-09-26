# Proposal

## Why

A reader cannot reach the beginning of a long conversation, and there is no way to take one away.
Both come from the same place: the client is only ever sent the part of the transcript the model
can still see.

The session file is append-only — compaction writes a `CompactionEntry` and deletes nothing — but
`snapshot()` builds its items from `buildContextEntries()`, which omits everything before the
latest compaction (`server/src/index.ts:1890`, `server/src/convert.ts:184`). Compaction is
automatic once the context window fills, so this happens to a long session unprompted, and the
interface says nothing about it: `compaction_start`/`compaction_end` set a transient
`isCompacting` flag (`ui/src/useAgent.ts:1150`) and leave no mark in the transcript. The reader
scrolls up, arrives at a message that is not the first one, and finds nothing above it — not
"loading", not "summarised", nothing. What they are looking at is already lost to them.

There is no conversation export at all. `docx-export` covers a document displayed in the viewer;
nothing takes the conversation itself away. A colleague who wants to archive an exchange, or send
it to someone who does not open this application, has the clipboard and a screenshot.

The two are one change because an export built on today's transcript would be wrong in a way
nobody could see: it would silently produce the post-compaction tail under a name that promises
the whole conversation. Reaching the prefix is the precondition for exporting it honestly.

## What Changes

- The transcript can be read back past compaction. The client asks for the items before the
  oldest one it holds; the server answers from the session file's own branch, which still has
  them. The reader gets a control at the top of the conversation and keeps their scroll position
  when older items arrive.
- Where compaction cut the context, the transcript says so, with a marker between the summarised
  prefix and what the model still sees. The compaction summary itself is what the model was left
  with, and is shown as such.
- Items recovered from before the compaction point are read-only: no editing, no forking. Their
  entry ids are not in the model's context, so an edit could not be honoured — the interface
  refuses it visibly instead of offering an action that would fail.
- The whole conversation can be taken away as a single self-contained HTML file: readable with no
  network, no JavaScript and no application, images inlined, diagrams as inline SVG, maths as
  MathML, tool calls as collapsed `<details>`, and a header naming the project, the session, the
  date and the model. Exporting loads whatever prefix is still missing first, so the file is the
  conversation and not the visible part of it.
- The export is a download and writes nothing into the workspace, as the Word export already
  does.

## Capabilities

### New Capabilities

- `conversation-history-pagination`: reading a conversation back beyond the model's context —
  what the server serves from the session file, what the client asks for and when, how the
  compaction boundary is shown, and what a recovered item may not be used for.
- `conversation-html-export`: taking a whole conversation away as one self-contained HTML
  document — what it must contain, what it must not depend on, and what it must not smuggle.

### Modified Capabilities

- `session-usage`: it owns the context-window indicator. Reading a compacted conversation back
  exposed a crash in the agent SDK — an assistant reply with no token counters is dereferenced
  unguarded once the branch holds a compaction entry, so exactly the sessions this change is about
  could fail to open at all. Reported upstream five times and closed as not planned each time, so
  the requirement is stated here: a conversation opens whether or not its context size can be
  computed, and the indicator says nothing it cannot establish.
- `api`: the protocol gains the request and reply that carry older transcript items, alongside
  the other request/response pairs specified there (`SessionSearchMessages`, `UploadFileMessage`).
  The answer goes to the requesting socket only, since a page's scroll position is not shared
  state.

## Impact

- `shared/src/protocol.ts` — a `history_before` client message and its reply; `ChatItem` gains the
  marker for a compaction boundary and the flag that makes an item read-only.
- `server/src/agentRuntime.ts` — a branch-entries capability on `AgentRuntime`. Optional, like
  `navigateTree?`: the embedded SDK runtime has `sessionManager.getBranch(leafId)`, which walks
  to the root through compaction entries rather than stopping at them; the Pi RPC dialect has no
  equivalent and reports that it cannot, rather than answering with a truncated branch.
- `server/src/embeddedRuntime.ts` — the branch-entries implementation, and a guard around the
  SDK's context-usage read so a session it cannot price still opens.
- `server/src/index.ts` — the message
  handler, converting the older entries through the same `historyToItems` the live transcript
  uses. No second renderer.
- `ui/src/useAgent.ts`, `ui/src/App.tsx` — prepending items with the scroll position preserved,
  the "older messages" control, the boundary marker, and disabling edit and fork on recovered
  items.
- `ui/src/export/` — a new client-side HTML writer beside the Word one, reusing
  `loadReferencedImage`, `mermaidToImage` and `util/download`. Lazy-imported from the click
  handler so a session that never exports never downloads it.
- Documentation: `README.md`'s feature list, and the conversation section of the user
  documentation.
- No configuration, no credentials, no change to what the model is sent. Compaction itself is
  untouched: this changes what the reader can see, not what the agent remembers.
