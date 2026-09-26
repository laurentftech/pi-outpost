# Design

## Context

See proposal.md — Why. What shapes the approach:

- **The session file already has everything.** `SessionManager.getBranch(fromId)` walks from an
  entry to the root and returns every entry on the way, compaction entries included — it does not
  stop at them the way `buildContextEntries()` does. That is the whole supply of missing
  transcript, on the active branch, in order.
- **One conversion, not two.** `sessionEntryToContextMessages(entry)` turns a session entry back
  into the `AgentMessage` shape `historyToItems` already consumes (`message`, `custom_message`,
  `branch_summary` and `compaction` all covered). Older items can therefore be converted by the
  same function that converts the live transcript, so a recovered message cannot render
  differently from a live one.
- **The context prefix is immutable.** Entries are appended, never rewritten. The set of entries
  before the current context window changes only when compaction runs again or the leaf moves
  (fork, tree navigation, session switch) — events the server already handles and broadcasts.
- **Diagrams and maths need a browser.** `ui/src/export/mermaidToImage.ts` renders mermaid by
  putting it in the document and reading the SVG back; KaTeX, the sanitiser and
  `loadReferencedImage` (which fetches `/files/raw` with the session token) all live in the UI.
  The Word export is client-side for these reasons and writes nothing into the workspace.
- **Only the embedded runtime can do this.** The Pi RPC dialect has no command that returns the
  session branch. Per the project's rule, the embedded SDK runtime is the supported target and RPC
  reports what it cannot do instead of approximating it.

## Goals / Non-Goals

**Goals:**

- One derivation of the transcript: recovered items, live items and exported items all come out of
  `historyToItems`.
- A cursor that cannot drift: no offsets into a list whose length depends on which conversion ran.
- An export that is true to its name — the whole conversation — or refuses, visibly.
- A file a colleague can open in five years: no network, no JavaScript, no application.

**Non-Goals:**

- Changing compaction, its threshold, or what the model is sent. This changes what the reader can
  see, not what the agent remembers.
- Editing, forking or branching from a pre-compaction message. Those entries are outside the
  model's context; the capability is reading, not rewriting history.
- Virtualising the conversation list. It is not virtualised today; this design keeps the loaded
  window bounded instead of making the list able to hold everything.
- Exporting to PDF, Markdown or Word. One format, chosen for archiving and sending.
- Searching or filtering the recovered prefix beyond what the existing conversation filters do.
- Recovering other branches. The transcript shows one branch; so does the export.

## Decisions

### The cursor is a count into the pre-context prefix, not an index into the transcript

`history_before { sessionId, requestId, have, count }` — `have` is how many prefix items the client
already holds, `count` how many more it wants. The reply carries the items immediately before them,
plus how many remain. `sessionId` is what the count was taken from: the server refuses a request for
a session it no longer holds rather than answering from the one it does, because a reply that
crossed a session switch would put one conversation's messages above another's and both clients
would look plausible.

The prefix is defined as the branch's items strictly before the context window — the entries
`getBranch()` yields that `buildContextEntries()` drops. Membership is asked of the context rather
than recomputed from the compaction's cut point, so the seam the reader sees is the seam the agent
actually has.

The converted prefix is cached, keyed by the session file and the identity of the last compaction
entry (its id and its first kept entry). An entry's ancestor chain is unique, so those two fix the
prefix: a later turn, a fork, or a move to another node of the same session cannot change it, while
a new compaction or another session changes the key. Keying on the leaf instead — the first sketch —
would have discarded the cache on every prompt for a prefix that had not moved.

Alternatives considered. *Cursor by entry id*: the obvious choice, and wrong here — only user
items carry an `entryId`, and only for entries in the model's context, so most items have no id to
cursor on. *An absolute index into the whole branch*: requires the client's first item to have a
known position, which means the server deriving the live items from the full branch on every
snapshot — the whole branch converted on a hot path, to answer a question nobody asked yet. Anchoring
on the prefix keeps the cost on the request that wants it, and makes "how many older messages are
there" answerable in the snapshot with one number.

### The compaction boundary becomes a transcript item

`historyToItems` currently skips compaction summaries (`server/src/convert.ts:300`). It stops
skipping them and emits a new `ChatItem` kind carrying the summary text. Three things follow from
one change: the live transcript gains a visible "the conversation was compacted here, this is what
was kept" mark even for a reader who never paginates; the boundary is positioned by the same
conversion as everything else rather than synthesised by the client at a place it guesses; and the
export inherits it.

Alternative: a client-side separator inserted where prepended items meet existing ones. Rejected —
it marks where *loading* happened, not where *compaction* happened, and it would show nothing at all
to the reader who never clicks.

### Recovered items are read-only, and say so

Items from the prefix carry a flag that disables editing and forking. The composer's edit path
needs an `entryId` in the model's context; a prefix entry has none it could use. The alternative —
leaving the actions enabled and letting the server refuse — trades a visibly disabled control for
an error message after the fact.

### The export runs in the client, and fetches its own history

This reverses the server-side rendering first sketched in discussion. Server-side cannot draw the
diagrams: mermaid needs a DOM, and the only way to get one there is a headless browser or a second
renderer that would drift from the one on screen. Client-side also inherits `loadReferencedImage`,
`mermaidToImage`, the sanitiser schema and `util/download` unchanged, and keeps the "nothing is
written into the workspace" invariant the Word export established.

The export does **not** read the DOM and does not require the transcript to be fully loaded on
screen. It issues the same `history_before` requests itself until nothing remains, then builds the
document from the item list. So exporting does not first force thousands of items into a
non-virtualised list, and what is collapsed or filtered on screen has no effect on the file.

Alternative considered: serialising the rendered conversation node. Highest fidelity for the least
code, and rejected — it exports the view (filters applied, tool cards collapsed, prefix absent)
under a name that promises the conversation, which is the defect this change exists to remove.

### The document is one file, with no assets and no script

Inline `<style>` written for the document rather than the application's Tailwind build; light and
dark through `prefers-color-scheme`; `<details>`/`<summary>` for tool calls, which fold natively
with no JavaScript; workspace images as `data:` URIs; mermaid and structured-exchange figures as
inline SVG with styles inlined, as the Word path already does before rasterising.

Maths is emitted as **MathML** (`rehype-katex` takes KaTeX's `output` option). KaTeX's HTML output
needs the KaTeX stylesheet and its woff2 fonts to be legible — several hundred kilobytes of base64
in every export, or a file that renders maths as scrambled glyphs offline. MathML renders natively
in current browsers with nothing attached.

Markup runs through the same pipeline the transcript uses — `remark-gfm`, `remark-math`,
`rehype-raw`, `rehype-sanitize` with `chatHtmlSchema` — and is stringified instead of turned into
React elements. The archive will be opened elsewhere, by someone who did not run the agent: it must
not carry script, and the filter that guarantees that is the one already reviewed for the
transcript, not a second one written here.

### The export refuses rather than truncates

If the runtime cannot serve the branch (Pi RPC), or a chunk fails, the export does not produce a
file containing whatever it managed to collect. It reports what is missing and exports nothing.
A partial archive is indistinguishable from a complete one once it has been sent.

## Risks / Trade-offs

- **A long session with many images makes a large file.** → The size is measured on a real session
  before the format is fixed. Images are inlined under a budget; past it the export stops and says
  what would have to be dropped, rather than silently shipping a document with holes.
- **Prepending items moves the scroll position.** → The scroll offset is restored from the scroll
  height delta after the prepend, and the behaviour is exercised in the running application, not
  only in a unit test — a jump here would reproduce the very complaint that started this.
- **The prefix cache could be served for the wrong branch.** → It is keyed by session file and leaf
  id and dropped on every event that moves either. This is the shape of the per-project git bug
  already seen in this codebase (a log rendered under another project's name), so the test asserts
  the pairing, not merely that items arrive.
- **`count` is a lever on server memory.** → Bounded server-side like the search query length is,
  and a request past the bound is clamped, not honoured.
- **Rendering many diagrams during an export is slow and silent.** → The export reports progress
  through its two stages (reading the history back, then writing the document), so the wait is
  legible. It is not cancellable: stopping half way produces nothing anyway, and a cancel control
  that only hides a running export would be a lie. If a real conversation turns out to take long
  enough to want one, that is a follow-up with a visible reason.
- **MathML rendering varies between browsers.** → Accepted. Chromium, Firefox and WebKit all render
  MathML Core today, and the trade is against an export that needs fonts attached to be readable
  at all.
- **A new dependency for HTML stringification** (`rehype-stringify`, or `hast-util-to-html`
  directly). → Small, same ecosystem as the plugins already in use, and it lands in the lazily
  imported export chunk rather than the main bundle.

## Migration Plan

No data migration and no stored format. The protocol addition is a new message pair plus two
optional fields: an older client ignores them, and a newer client seeing a snapshot without them
shows exactly today's transcript with no control to load more. Nothing written by this change is
persisted, so rollback is the revert.

## Open Questions

- Whether the reading window should also drop items when the reader scrolls far back down again, if
  a very long prefix loaded in chunks makes the list sluggish. Deferred: it is a tuning decision
  inside the loaded window, and it changes neither the protocol nor the specs.
