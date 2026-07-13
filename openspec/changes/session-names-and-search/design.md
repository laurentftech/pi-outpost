## Context

Sessions are pi SDK session files (JSONL trees) listed by `SessionManager.list(cwd, sessionDir)`. The server already forwards each `SessionInfo` to the UI as a `SessionSummary` (`server/src/index.ts` `listSessions`), and the UI already renders `session.name || session.firstMessage` (`web/src/components/Header.tsx`, `SessionMenu`). Nothing ever writes `name`, so the fallback is all anyone sees.

Three SDK facts shape this design:

- A session name is a `session_info` entry, appended like any other entry. `AgentSession.setSessionName(name)` writes it for the live session; `SessionManager.open(path).appendSessionInfo(name)` writes it for a session we are not running.
- `SessionInfo` already carries `allMessagesText` — the whole transcript as text — so `list()` gives us content search for free, with no extra file reads.
- `generateBranchSummary(entries, { model, apiKey, signal, customInstructions, replaceInstructions: true })` is the SDK's existing "ask the model about a slice of a session" call (it produces the branch labels the tree already shows). With `replaceInstructions: true` the prompt is entirely ours, so the same call yields a title instead of a prose summary.

## Goals / Non-Goals

**Goals:**
- A session shows a topic, not its opening line, without the user having to do anything.
- The user can override any name, and clear it.
- A session can be found by anything ever said in it, from the same menu, with the match shown.
- Cost and failure of title generation are invisible: a failed title is a missing title, never an error.

**Non-Goals:**
- Renaming from the CLI/TUI (the SDK already has that).
- Regenerating a title as a session evolves, or re-titling old sessions in bulk. One title, at the first exchange; the user renames if it ages badly.
- Fuzzy/regex/relevance ranking. The SDK's TUI has `filterAndSortSessions` for that, but it lives under `dist/modes/interactive` and is not part of the package's public surface — substring matching is enough to find a session and keeps us off a private import.
- Searching *inside* the open conversation (that is the tree's search).

## Decisions

### Auto-title once, after the first exchange, off the prompt path

The server generates a title when a turn ends *and* the session has never carried a name *and* it has at least one user message with a reply.

"Never carried a name" is the presence of a `session_info` entry in the file — **not** `getSessionName() === undefined`. The SDK maps an empty `session_info` back to `undefined`, so a name the user *cleared* is indistinguishable from one that never existed: keying on the name would re-title, on the very next turn, exactly what the user just erased. Keying on the entry makes the decision permanent in both directions (titled, renamed, or deliberately blank).

It runs after `agent_end`, not inside the prompt handler, so a slow or hanging title call cannot delay the reply the user is waiting for.

*Alternative considered:* title on every turn, or on session close. Every turn means paying for the model repeatedly and fighting the user's rename; session close is unreliable (the server may be killed) and would leave the menu unnamed exactly when the user goes looking for it.

*Alternative considered:* derive the title mechanically (first sentence, keywords). That is what `firstMessage` already is, and it is the thing being fixed.

### Call the session's own stream function, not the SDK's summarizers

The obvious candidates are the SDK's `generateBranchSummary` / `generateSummary`, which already know how to run the model over session entries. Both are the wrong tool: they post-process the answer into a *summary artifact* — `generateBranchSummary` prepends "The user explored a different conversation branch before returning here." and appends the file lists — which would land verbatim in the session menu. (This was tried; that sentence is what the first generated "title" was.)

Instead we call `session.agent.streamFn` directly: one request, our own system prompt ("you name conversations… 3 to 6 words… title only"), the opening exchange as the user message, `maxTokens: 200`. No agent state is touched and no event is emitted.

Auth comes from `services.modelRegistry.getApiKeyAndHeaders(model)` — but note it resolves the key *eagerly*, and deliberately skips the environment-variable fallback, so `apiKey` is legitimately undefined for a provider like mistral whose key lives in `MISTRAL_API_KEY`. Passing the session's `streamFn` is what makes that work: it resolves credentials exactly the way a normal turn does. Requiring a non-empty `apiKey` here would silently disable titling for those providers.

### Sanitize the model's answer before persisting

A title is a single line of plain text: first line only, trimmed, surrounding quotes stripped, capped at 80 characters. A model that answers with a paragraph produces a truncated line, never a wall of text in the menu.

### Rename works on any session, behind the existing allowlist

`rename_session { path, name }`. If `path` is the live session's file → `runtime.session.setSessionName()`, so the running `AgentSession` and the file agree. Otherwise → `SessionManager.open(path).appendSessionInfo(name)`.

That branch is load-bearing, not cosmetic: opening a *second* `SessionManager` over the live file can rewrite it wholesale (the SDK migrates on open), racing the live session's appends and losing transcript. The two paths also come from different normalizers (`SessionManager.list` joins a normalized dir; the live one is resolved), so the comparison resolves both sides rather than trusting string equality.

The path comes from a client, so it goes through the existing `isKnownSessionPath()` check — the same authoritative allowlist `switch_session` and `delete_session` use. No path traversal, no writing to attacker-chosen files. An empty/whitespace name clears the title (persist `""`; `name || firstMessage` in the UI already handles the fallback).

After a rename the server re-lists and **broadcasts** the `sessions` frame: every connected client sees the new name, since they all watch the same agent.

### Search runs on the server, over the full transcript

`search_sessions { query, requestId }` → the server calls `SessionManager.list()`, filters case-insensitively over `name`, `firstMessage` and `allMessagesText`, sorts by `modified` descending, caps at 50, and answers `session_search_results { requestId, query, sessions }`. Each hit carries a `snippet`: ~120 characters of `allMessagesText` centered on the first occurrence, whitespace-collapsed, ellipsized.

Server-side is not just symmetry with the file search: `allMessagesText` for fifty sessions is megabytes, and shipping it to the browser to filter there would make opening the menu expensive for every user, searching or not. The `requestId` lets the client drop stale answers as the user types — the same pattern the file browser already uses.

Because every query re-reads the whole store, the scan is throttled from three sides: a minimum query length (`MIN_SESSION_QUERY_LENGTH`, shared so the client doesn't even ask), a maximum (200 chars — a client shouldn't get to scan every transcript with a novel), and a 1-second TTL on the `SessionManager.list()` result, invalidated by any write (rename, title, delete). The UI shows "no matches" only once the answer for *that* query has landed; a query in flight reads as loading, not as a miss.

## Risks / Trade-offs

- **Title generation costs tokens on the user's own key.** → One call per session, at the first exchange, on the model already in use. No key, no title.
- **`replaceInstructions: true` means we own the prompt quality.** A model may still answer with a sentence. → Sanitization (first line, 80 chars) bounds the damage; the user can always rename.
- **A title generated from the first exchange can age badly** (the session drifts to another topic). → Accepted: manual rename is one click, and re-titling would silently overwrite names the user chose.
- **Substring search misses typos and word order.** → Accepted for now; it matches the tree's search, which users already understand.
- **`SessionManager.list()` reads every session file on every search keystroke.** → Debounced client-side (~200 ms) and capped at 50 results; the same call already runs every time the menu opens.
- **The auto-title races a manual rename, or a session switch.** → The in-flight set is keyed by session file (two sessions can be titled in parallel; the same one never twice), and the guards are re-checked *after* the model answers: the title is dropped if a `session_info` entry appeared meanwhile, if the runtime moved to another session, or if a session replacement is in progress (during which `runtime.session` still points at an already-disposed session — writing there would emit into a torn-down extension runner).
- **A rename does synchronous file I/O on the event loop** (`SessionManager.open` reads the whole transcript, `appendSessionInfo` appends). → Accepted: renaming is a rare, user-initiated act, and the SDK exposes no async variant.
