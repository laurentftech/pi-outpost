# Server tests

Integration tests boot a real server (`node --import=tsx/esm src/index.ts`) against a
throwaway workspace in `$TMPDIR` and talk to it over HTTP/WebSocket, the way a browser does.
The server and its wiring are not mocked; suites that need a deterministic external boundary
may use a controlled provider, npm executable or RPC child. What these guard is the wiring
(path confinement, auth, process supervision, session bookkeeping) that unit tests of pure
functions cannot see.

The harness pins `agentDir` inside the temp workspace, so runs never touch your real
`~/.pi/agent` (no reading your extensions, no writing your sessions).

Long-running command fixtures must have an explicit teardown release and wait for their
process to exit before `server.stop()` removes the workspace. On Windows, killing Git Bash
can leave native descendants orphaned, so waiting for the server to close does not prove
that the workspace is free. `queuedPromptsWire.test.mjs` uses a release file for this and
waits for the command's readiness marker before testing interruption.

```bash
npm run test --workspace server        # offline: no model auth needed, no tokens spent
npm run test:live --workspace server   # drives real agent turns (needs model auth, costs tokens)
```

| Suite | Guards |
|-------|--------|
| `auth.test.mjs` | WebSocket token check (valid connects; missing/wrong closes 4401 with no data), `/branding` Bearer, `/health` session-id redaction, unchanged behavior without a token |
| `files-raw.test.mjs` | `/files/raw`: confinement (traversal, absolute paths, symlink escapes → 404), 1 MiB cap → 413, image content types, non-images served as `attachment` (an HTML file must never render on our origin), SVG served with a scripts-off CSP, DNS-rebinding Host guard on token-less servers, token gating |
| `work-plan-server.test.mjs` | Persisted Work Plan synchronization and authoritative workspace activity transitions, including ready-for-review, acknowledgement, and resumed work |
| `outcome-server.test.mjs` | Correlated, requester-only workspace Outcome capture over the real WebSocket boundary, including current plan/evidence and git changes |
| `outcome.test.ts` / `outcome-shared.test.ts` | Deterministic contributor composition, conservative verification aggregation, safe targets, legacy states, and repository partial failures |
| `multiProjectWorkspaces.test.mjs` | Concurrent workspace lifecycle, switching, generic attention summaries, simultaneous review-ready projects, and cross-workspace isolation |
| `multiProjectLifecycle.test.mjs` | Idle retirement and retention of workspaces that are working, waiting for the user, or ready for review |
| `live/conversation-branching.test.mjs` | Editing a past prompt branches the session and the original exchange stays restorable *with its reply* (`tipId`); navigating to the turn itself rewinds with composer prefill; unknown entry ids refused; **the phantom-bubble regression** — a message an extension swallowed is echoed but never persisted, so pairing must fail closed instead of handing that bubble the previous turn's entry id (aligning by position would make an edit rewind the wrong turn) |

`fixtures/swallow-extension.ts` is what produces that phantom: an `input` handler returning
`{ action: "handled" }`, exactly like an extension slash command.
