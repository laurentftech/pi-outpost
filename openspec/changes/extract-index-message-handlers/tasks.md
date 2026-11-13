# Tasks

## 1. Extract Git message handlers

- [ ] 1.1 Add the Git handler module and a narrow typed context using existing workspace/Git services; verify `npm run typecheck --workspace server` passes.
- [ ] 1.2 Move Git status, diff, log, file-history, file-diff, and show handling plus their dispatcher cases in bounded edits; keep `get_outcome` in `index.ts`; verify from `server/` with `node --import tsx/esm --test --test-timeout=300000 test/git.test.ts test/git-file-history.test.mjs test/git-repos.test.ts test/git-failure-message.test.ts` and then `npm test --workspace server`.

## 2. Extract file browsing and search handlers

- [ ] 2.1 Add the file-browser handler module and typed context; move directory listing, file read/write, arrangement, create/rename/delete/move/upload/copy/batch/restore helpers in bounded edits; verify `npm run typecheck --workspace server` passes.
- [ ] 2.2 Move file/content search and cancellation, update all lifecycle callers of `abortContentSearch`, and route file messages from the dispatcher; verify from `server/` with `node --import tsx/esm --test --test-timeout=300000 test/fileBrowser.test.ts test/fileBrowserFailures.test.ts test/file-lifecycle.test.mjs test/file-upload.test.mjs test/files-raw.test.mjs` and then `npm test --workspace server`.

## 3. Extract Pi package handlers

- [ ] 3.1 Add the package handler module and typed context; move package listing/refresh/bookkeeping and package update/lookup/install/remove/restore handlers in bounded edits; provide restart notification through an injected callback; verify `npm run typecheck --workspace server` passes.
- [ ] 3.2 Route package messages through the new module and update package refresh callers in workspace startup and server startup; verify from `server/` with `node --import tsx/esm --test --test-timeout=300000 test/piPackages.test.ts test/piPackagesWire.test.mjs test/piPackagesInstall.test.ts test/piPackagesInstallWire.test.mjs test/piPackagesUpdate.test.ts test/piPackagesUpdateCommand.test.mjs` and then `npm test --workspace server`.

## 4. Extract agent-resource handlers

- [ ] 4.1 Add the agent-resource handler module and typed context; move clone/enroll/refresh, collection/skill selection, remove/update handlers in bounded edits; inject restart-reason notification instead of importing `index.ts`; verify `npm run typecheck --workspace server` passes.
- [ ] 4.2 Route agent-resource messages through the new module and preserve workspace-specific broadcasts and request correlation; verify from `server/` with `node --import tsx/esm --test --test-timeout=300000 test/agentResourcesWire.test.mjs test/resourceRepositories.test.ts` and then `npm test --workspace server`.

## 5. Extract session, history, and tree handlers

- [ ] 5.1 Add the session handler module and typed context; move session scan/list/search/rename/switch/delete, history, tree navigation, fork, and naming helpers in bounded edits; keep `maybeNameSession` callable from runtime events without importing `index.ts`; verify `npm run typecheck --workspace server` passes.
- [ ] 5.2 Route session/history/tree messages through the new module while preserving workspace isolation, response ordering, and malformed-message behavior; verify from `server/` with `node --import tsx/esm --test --test-timeout=300000 test/sessions.test.ts test/sideSessions.test.mjs test/session-names.test.mjs test/history-wire.test.mjs test/documentToolsWire.test.mjs test/malformedMessagesWire.test.mjs test/work-plan-server.test.mjs` and then `npm test --workspace server`.

## 6. Verify the completed extraction

- [ ] 6.1 Remove stale imports and check the five handler modules have no import from `server/src/index.ts`; verify the dependency boundary with `rg` and run `npm run typecheck --workspace server`.
- [ ] 6.2 Review `git diff` to confirm only the intended server files changed, protocol/frontend behavior stayed untouched, and the net extraction is in the intended roughly 1,500–2,000-line range; run `npm test --workspace server` as the final integration gate.
