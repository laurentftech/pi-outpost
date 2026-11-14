# Proposal

## Why

A directory that should have been ignored but was not — a Cargo cache, a build output, a forgotten `node_modules` — put ~31,000 untracked files in `git status`. The status is asked again on every file change, every save and every agent turn, listed with `--untracked-files=all`, sent in full to every connected client, and replaced wholesale in the client's state. Opening a file took seconds. Nothing in those files moved; what saturated was their presence in a status recomputed and resent in full dozens of times a session.

## What Changes

- The server asks git for the status with untracked directories collapsed, then lists each untracked directory file by file only up to 2,000 files; a larger one is reported as one entry saying it holds at least that many. Git no longer walks, and the server no longer parses or sends, every file of such a directory.
- Every git_status answer carries a version. A client names the version it holds when it asks again, and the server answers with only what changed since: upserted entries and removed paths. A request without a version the server recognises is answered in full.
- The file tree badges a collapsed directory "N+", and the Outcome lists it as one entry.

## Capabilities

### Modified Capabilities
- `git`: `WorkingTreeStatus` bounds the untracked listing; new `StatusSentAsChanges` and `CollapsedUntrackedDirectoryBadge`.

## Impact

- `server/src/git.ts` (`gitStatusFor`): `--untracked-files=normal` plus a bounded `git ls-files --others --exclude-standard` per collapsed directory.
- `server/src/index.ts` (`handleGitStatus`): per-connection last-sent status and version; delta answers.
- `shared/src/protocol.ts`: `GitFileStatus.atLeast`, `git_status` request `base`, answer `version` / `base` / `removed`.
- `ui/src/useAgent.ts`: apply deltas, keep the version, fall back to a full request on a mismatch.
- `ui/src/components/FileTree.tsx`: "N+" badges; `server/src/outcome.ts`: one entry for a collapsed directory.
