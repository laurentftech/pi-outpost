# Tasks: conversation-branching

> Implemented ahead of the spec in commit `0da961b` (tree graph, reply tips, prompt editing) after a
> code-review pass that fixed the pairing and serialization defects. Groups 1–4 record that work —
> tick them after verifying the code matches the specs. Group 5 is the remaining follow-up.

## 1. Protocol

- [x] 1.1 `TreeNode.tipId`, `ChatItem` user `entryId` in `shared/src/protocol.ts`
- [x] 1.2 `edit_prompt` ClientMessage and `user_entries` ServerMessage (entries carry `{entryId, text}`)

## 2. Server

- [x] 2.1 `replyTip` in `buildTree` (descends through non-user entries, returns the last plain `message` entry, never a `custom_message`; undefined when absent or ambiguous)
- [x] 2.2 `treeNavigationTargets(roots)` allowlist; `navigateTree` accepts turns *and* reply tips
- [x] 2.3 `branchUserEntries()` + `user_entries`/`tree` broadcast once a turn persists; `historyToItems(messages, streaming, userEntryIds)`
- [x] 2.4 `editPrompt()`: streaming guard, user-entry check, `replacingSession` held across the rewind, veto reported as an error
- [x] 2.5 `replacingSession` guard on the `prompt` path

## 3. Client

- [x] 3.1 `user_entries` reducer case: pair from the end, stop at the first text mismatch, drop stale ids
- [x] 3.2 `editPrompt` action in `useAgent`
- [x] 3.3 `UserMessage.tsx`: inline editor (Enter sends, Escape cancels, disabled while streaming/disconnected, draft dropped when the item changes underneath)
- [x] 3.4 `TreeMenu.tsx`: lane layout (current path on lane 0, reserved color), rails/fork curves, chips, search on text + labels, row click → `tipId ?? entryId`, `↺ redo` → `entryId`, `⑂ fork`

## 4. Verification

- [x] 4.1 Browser E2E: edit a prompt → new branch, original preserved in the tree; select the abandoned branch → transcript restored with its reply, composer empty; `↺ redo` → text back in the composer
- [x] 4.2 Typecheck + `npm run build --workspaces --if-present`
- [x] 4.3 Code review pass; blocking findings fixed (pairing by text, `prompt` serialization, `custom_message` tips, draft lifetime, silent veto)

## 5. Tests

- [x] 5.1 Integration-test harness in the repo (`server/test/harness.mjs`): boots a real server against a throwaway workspace with an isolated `agentDir` (never the developer's `~/.pi/agent`), WS/HTTP client helpers; `npm run test` (offline) and `npm run test:live` (drives real turns)
- [x] 5.2 Phantom-bubble regression test + `fixtures/swallow-extension.ts` (an `input` handler returning `handled`): the swallowed prompt is echoed, never persisted, carries no entry id, and no other bubble is paired with the wrong entry
- [x] 5.3 Live branching tests: editing a prompt branches and the original exchange is restorable with its reply (`tipId`); navigating to the turn itself rewinds with prefill; unknown entry ids refused
- [x] 5.4 Port the throwaway scratchpad checks into the repo: auth (WS 4401 / Bearer / health redaction) and `/files/raw` (confinement, 1 MiB cap, content types, attachment for non-images, SVG CSP, DNS-rebinding Host guard, token gating)

## 6. Follow-up

- [x] 6.1 Sync the delta specs into `openspec/specs/` and archive this change
