## Why

The session menu lists every saved session by its first prompt, truncated — so the list reads as a pile of opening lines ("hey", "can you look at the websocket thing"), not as a list of topics, and past work is hard to recognize. And unlike the conversation tree, which has a search box, sessions cannot be searched at all: you scroll fifty rows and guess.

The pieces already exist and are simply unused: the pi SDK persists a session display name (`session_info` entry), `SessionManager.list()` already returns it *and* the full transcript text of every session, and the wire type `SessionSummary` already carries an optional `name` the UI already prefers. Nothing writes the name, and nobody searches the text.

## What Changes

- **Sessions get a real name.** After the first exchange lands, the server generates a short title (3–6 words) from that exchange and persists it on the session. Generation is best-effort and off the prompt path: if it fails, the session simply stays unnamed and the UI keeps showing the first message.
- **Any session can be renamed by hand**, live or not, from the session menu (inline ✎ on the row). A blank name clears the title and falls back to the first message.
- **Sessions become searchable**, the way the conversation tree already is. The search runs server-side over the session name, first message and *the full transcript*, so a session can be found by anything ever said in it — and each hit shows the matching excerpt.
- Three new wire messages (`rename_session`, `search_sessions`, `session_search_results`) and one new optional field on `SessionSummary` (`snippet`).

## Capabilities

### New Capabilities
- `session-name`: how a session acquires a display name — auto-generated after the first exchange, renameable and clearable by the user, persisted in the session file.
- `session-search`: finding a saved session by name, first message or transcript content, with match excerpts.

### Modified Capabilities
- `api`: the WebSocket protocol gains `rename_session` / `search_sessions` (client → server) and `session_search_results` (server → client), plus `SessionSummary.snippet`.

## Impact

- `shared/src/protocol.ts` — new message variants, `SessionSummary.snippet`.
- `server/src/index.ts` — auto-title after the first turn (reusing the SDK's `generateBranchSummary` with replaced instructions, and `authStorage.getApiKey`), rename handler (`AgentSession.setSessionName` for the live session, `SessionManager.open().appendSessionInfo()` for the others, both behind the existing `isKnownSessionPath` allowlist), and a server-side session search over `SessionInfo.allMessagesText`.
- `web/src/useAgent.ts` — `renameSession` / `searchSessions` actions and the search-results reducer case.
- `web/src/components/Header.tsx` — search input and inline rename in `SessionMenu`.
- No new dependency; no migration (unnamed sessions keep rendering as they do today).
