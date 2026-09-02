## 1. Protocol and inventory model

- [ ] 1.1 Add backward-compatible protocol types for resource provenance, repository groups, discriminated assessment states, revision-bound update requests, and per-workspace reload results; verify shared type checks and protocol serialization tests pass.
- [ ] 1.2 Extend runtime snapshots/adapters with skill and extension provenance capability markers, preserving embedded SDK source data and representing missing RPC paths or extension inventory as unavailable; verify adapter tests cover both complete and incomplete runtimes.
- [ ] 1.3 Build stable resource identifiers and canonical repository grouping from server-known loaded/configured paths, including symlink resolution, duplicate roots, mixed resources, and nearest nested worktrees; verify focused unit tests cover every Resource provenance inventory scenario.

## 2. Resource repository assessment

- [ ] 2.1 Extract or reuse only the Git executable resolution and hardened spawn primitives needed by a new resource-repository service without widening workspace Git commands; verify existing Git confinement tests and the Resource updater does not expand workspace Git authority scenario pass.
- [ ] 2.2 Implement the server-owned repository registry with opaque ids and canonical-root validation, rejecting paths or revisions supplied by clients; verify tests prove unknown ids start no Git process and out-of-provenance worktrees never enter the registry.
- [ ] 2.3 Implement bounded, per-repository remote refresh and parse clean/current/updateable/dirty/detached/ahead/diverged/no-upstream/locked/unavailable/failed assessments; verify real temporary-repository tests cover all Repository update assessment scenarios and isolate a failing remote from successful repositories.
- [ ] 2.4 Add a small concurrency bound and request correlation to multi-repository refresh; verify a stress test observes the configured bound and keeps each result keyed to its repository.

## 3. Guarded fast-forward updates

- [ ] 3.1 Implement revision-bound assessment tokens and a per-canonical-repository mutex, then repeat worktree, branch, upstream, ancestry, extension-lock, and expected-revision checks under the lock; verify stale and concurrent request tests cover Repository changes after assessment, Concurrent updates target one repository, and Confirmation becomes stale.
- [ ] 3.2 Implement fetch plus exact-upstream fast-forward integration with fixed argument shapes, no shell, bounded output/time, and a server-owned empty hooks directory; verify real Git integration tests advance only eligible branches and prove repository hooks do not execute.
- [ ] 3.3 Enforce the updater-only boundary for dirty and non-fast-forward repositories; verify command-spy and filesystem tests prove no commit, stash, discard, reset, rebase, non-fast-forward merge, push, branch switch, or client-selected revision occurs.
- [ ] 3.4 Enforce executable-code acknowledgement and `extensionLock` server-side for extension-bearing and mixed repositories while leaving inspection and skill-path editing available; verify every Extension update protection and modified ExtensionLock scenario passes, including a direct request bypassing UI controls.

## 4. Workspace lifecycle coordination

- [ ] 4.1 Build and maintain the repository-to-workspace reverse index from configured/default root overlap and loaded provenance; verify tests cover repositories shared by several workspaces and resource additions/removals not present in the old inventory.
- [ ] 4.2 Reject updates before Git mutation when any affected started workspace is processing or replacing a turn, without starting dormant workspaces; verify Affected workspace is busy and Unstarted workspace loads later with lifecycle integration tests.
- [ ] 4.3 After a fast-forward, rebuild every affected started idle runtime, broadcast refreshed inventories, and return per-workspace outcomes; verify Shared repository reloads all affected idle workspaces and multi-client snapshot tests pass.
- [ ] 4.4 Preserve and report an advanced repository when any rebuild fails, exposing `updated-reload-failed` without destructive compensation; verify Reload fails after Git succeeds asserts both the new on-disk commit and the explicit partial failure.

## 5. Repository-first interface

- [ ] 5.1 Add the Settings entry point and production Agent resources split dialog using prototype A's repository-first layout, with repository/pseudo-group selection and separate skill and extension lists; verify component tests cover Open repository-first resource manager and Provenance-unavailable resources stay visible.
- [ ] 5.2 Add search, resource-kind filters, attention filtering, counts, status explanations, external-terminal guidance, and updater-only disabled states; verify component tests cover Search and attention filters preserve repository context and Dirty repository directs resolution outside the app.
- [ ] 5.3 Add revision-specific executable-extension confirmation and correlate pending/results by repository and request id; verify component tests cover Extension confirmation precedes update callback and Selection changes during an operation.
- [ ] 5.4 Wire refresh, refresh-all, update, reload-result, and snapshot events through application state without removing existing skill/extension path controls; verify client/server integration tests exercise one skill-only repository, one extension repository, and one non-updateable pseudo-group.

## 6. Documentation and completion proof

- [ ] 6.1 Document repository discovery, updater-only Git behavior, dirty-repository remediation, extension confirmation/lock semantics, RPC provenance limitations, fetch authentication, and reload partial failures; verify documented commands and internal links against the implementation.
- [ ] 6.2 Enumerate every applicable main and delta `#### Scenario:` with `rg '^#### Scenario:' openspec/`, create an explicit scenario-to-test matrix with test names and assertions, and close every partial or uncovered row before completion.
- [ ] 6.3 Run focused unit and integration tests, the relevant server/web suites, type checks, and `openspec validate manage-git-backed-agent-resources --strict`; record the passing commands in the implementation handoff.
- [ ] 6.4 Exercise the production feature in the running app with Playwright: complete inventory, refresh, skill update, extension confirmation, lock, dirty, busy, stale-assessment, and reload-failure paths, then monkey-test rapid refresh/update, double clicks, selection/workspace changes mid-request, disappearing repositories, and expand/filter bursts while asserting DOM, filesystem, and session state after each transition.
