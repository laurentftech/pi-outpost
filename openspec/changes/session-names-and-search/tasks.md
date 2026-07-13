## 1. Protocol

- [x] 1.1 Add `snippet?: string` to `SessionSummary` in `shared/src/protocol.ts`, documented as "matched excerpt, search results only"
- [x] 1.2 Add `rename_session { path, name }` and `search_sessions { query, requestId }` to `ClientMessage`
- [x] 1.3 Add `session_search_results { requestId, query, sessions }` to `ServerMessage`

## 2. Server — naming

- [x] 2.1 Extract the `SessionSummary` mapping out of `listSessions` into a helper, so search results and the plain list build rows the same way
- [x] 2.2 Add `generateSessionTitle()`: title the opening exchange through the live session's `agent.streamFn` (the SDK's summarizers wrap their answer in a branch/compaction preamble — unusable as a name); return `undefined` on any failure
- [x] 2.3 Sanitize the answer: first line, trimmed, surrounding quotes stripped, capped at 80 chars
- [x] 2.4 Call it after a turn ends (post `agent_end`, off the prompt path) only when `sessionManager.getSessionName()` is undefined and the session has a user message with a reply; persist with `runtime.session.setSessionName()` and broadcast a refreshed `sessions` frame
- [x] 2.5 Swallow and log title-generation failures — never emit an `error` frame for them

## 3. Server — rename

- [x] 3.1 Add `renameSession(socket, path, name)`: refuse a path that fails `isKnownSessionPath()` with `error: "Unknown session"`; trim and cap the name; an empty name clears it
- [x] 3.2 Live session → `runtime.session.setSessionName(name)`; any other session → `SessionManager.open(path).appendSessionInfo(name)`
- [x] 3.3 After a successful rename, re-list and **broadcast** the `sessions` frame (all clients watch the same agent)
- [x] 3.4 Wire `rename_session` into the `handleClientMessage` switch

## 4. Server — search

- [x] 4.1 Add `searchSessions(socket, query, requestId)`: `SessionManager.list()`, case-insensitive match on `name` / `firstMessage` / `allMessagesText`, sort by `modified` desc, cap 50
- [x] 4.2 Build a `snippet` per hit: ~120 chars of `allMessagesText` centered on the first occurrence, whitespace-collapsed, ellipsized at both ends when truncated
- [x] 4.3 Answer `session_search_results` to the requesting socket only (never broadcast, never ship `allMessagesText`)
- [x] 4.4 Wire `search_sessions` into the `handleClientMessage` switch

## 5. Web — state

- [x] 5.1 `web/src/useAgent.ts`: add `renameSession(path, name)` and `searchSessions(query)` actions
- [x] 5.2 Track the latest search `requestId` and reduce `session_search_results`, dropping answers whose id is stale (same pattern as the file-browser requests)
- [x] 5.3 Clear search results when the query is emptied and when the session menu closes

## 6. Web — session menu

- [x] 6.1 `web/src/components/Header.tsx` (`SessionMenu`): add a `type="search"` input at the top of the dropdown, mirroring `TreeMenu`'s (placeholder, `aria-label`), debounced ~200 ms
- [x] 6.2 Render results instead of the list while a query is active: name (or first message), the `snippet`, and an explicit "no matches" state
- [x] 6.3 Add a ✎ button per row that swaps the row into an inline text input prefilled with the current name — Enter commits, Escape cancels, empty commits a clear
- [x] 6.4 Keep the row's existing switch/delete behavior intact (delete still hidden for the active session)

## 7. Tests & verification

- [x] 7.1 Add `server/test/session-names.test.mjs` on the existing harness: rename an idle session → it comes back named in `sessions`; rename with an unknown path → `error`, nothing written; empty name → name cleared
- [x] 7.2 Add search coverage: seed a session whose match is only mid-transcript, search for it, assert it is returned with a snippet and that no result carries the full transcript
- [x] 7.3 `npm run typecheck` across workspaces; `npm test --workspace server` (20/20 pass)
- [x] 7.4 Live: `server/test/live/session-title.test.mjs` drives a real turn and asserts the session comes back titled (passes; the sky question titled itself "Why the sky is blue")
