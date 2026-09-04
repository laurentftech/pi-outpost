# Scenario coverage

Enumerated with `rg '^#### Scenario:' openspec/`. All 61 delta scenarios and the pre-existing main scenarios whose requirements this change modifies are covered by assertions that exercise their observable contract.

## Agent resource management delta

| Scenario | Coverage | Assertion evidence |
|---|---|---|
| `agent-resource-management / Add a local skill folder` | covered | `ui/src/components/AgentResourceManager.test.tsx` — “adds a local skill folder once through the picker” asserts the chosen directory is added exactly once. |
| `agent-resource-management / Add a local extension folder` | covered | `ui/src/components/AgentResourceManager.test.tsx` — “requires an executable warning and respects extension lock for local folders” asserts the unlocked, acknowledged extension path is applied. |
| `agent-resource-management / Activated external resources remain readable` | covered | `server/test/sandboxSettingsWire.test.mjs` — the skill and extension cases add roots outside the sandbox through Settings, then make the replacement agent use its real `read` tool and assert the configured body is returned without an access denial; `e2e/settings-sandbox.spec.ts` repeats the skill path through the running resource manager. |
| `agent-resource-management / Refused replacement rolls enrollment back` | covered | `server/test/sandboxSettingsWire.test.mjs` — “an extension veto rolls back the sandbox instead of acknowledging a split boundary” asserts the failed replacement leaves persisted settings, browser root, resources, and the retained agent on the prior boundary. |
| `agent-resource-management / Add a repository containing skills and extensions` | covered | `server/test/resourceRepositories.test.ts` — “clones a validated address into the explicit local folder and previews resources” asserts both recognized kinds; `server/test/agentResourcesWire.test.mjs` — enrollment persists selected roots. |
| `agent-resource-management / Enrollment does not execute extensions during preview` | covered | `server/test/resourceRepositories.test.ts` — “previews recognized roots without executing extension modules” uses an extension with a side effect and asserts it never occurs. |
| `agent-resource-management / Extension lock permits skill-only enrollment` | covered | `server/test/agentResourcesWire.test.mjs` — “extension lock filters a mixed preview while allowing skill-only enrollment” asserts skills persist and extensions do not. |
| `agent-resource-management / Clone address is required and confined` | covered | `ui/src/components/AgentResourceManager.test.tsx` — repository preview remains disabled without an address; `server/test/resourceRepositories.test.ts` — occupied and unsafe destinations are refused before Git runs. |
| `agent-resource-management / Clone has no recognizable resources` | covered | `server/test/resourceRepositories.test.ts` — “reports a resource-empty clone without registering paths…” asserts the empty preview and no enrollment. |
| `agent-resource-management / Re-add the same repository address` | covered | `server/test/resourceRepositories.test.ts` — “reuses the same-origin clone…” asserts the existing canonical checkout is reused. |
| `agent-resource-management / Re-enroll an existing repository` | covered | `server/test/resourceRepositories.test.ts` — “revalidates previews…” and the wire enrollment test assert current candidate roots are revalidated and deduplicated. |
| `agent-resource-management / Several configured roots resolve to one repository` | covered | `server/test/resourceRepositories.test.ts` — “deduplicates mixed roots…” asserts several roots produce one repository group. |
| `agent-resource-management / Resources span several repositories` | covered | `server/test/resourceRepositories.test.ts` — “bounds multi-repository refresh concurrency and keeps results correlated” asserts distinct repository assessments. |
| `agent-resource-management / Nested repository owns its resource` | covered | `server/test/resourceRepositories.test.ts` — “deduplicates mixed roots and assigns a nested repository to itself” asserts longest repository ownership. |
| `agent-resource-management / Mixed repository` | covered | `server/test/resourceRepositories.test.ts` — mixed roots test asserts skill and extension resource IDs share one repository. |
| `agent-resource-management / Provenance is unavailable` | covered | `server/test/resourceRepositories.test.ts` — “keeps pathless runtime resources visible and unavailable”; `server/test/pi-rpc.test.ts` asserts a pathless RPC skill remains visible with incomplete provenance. |
| `agent-resource-management / A repository needing credentials fails instead of waiting` | covered | `server/test/agentResourcesWire.test.mjs` — credential-bearing clone fails within the bounded request and returns a correlated error. |
| `agent-resource-management / Configured git authentication still works` | covered | `server/test/resourceRepositories.test.ts` — successful clone/fetch fixtures run through normal Git configuration while the service only disables prompts and hooks. |
| `agent-resource-management / Clean branch is behind its upstream` | covered | `server/test/resourceRepositories.test.ts` — branch classification test asserts `behind` with an update token only for the fast-forwardable case. |
| `agent-resource-management / Local changes block updating` | covered | `server/test/resourceRepositories.test.ts` — “classifies dirty worktrees without changing them” asserts dirty status and unchanged files. |
| `agent-resource-management / Non-fast-forward states are blocked` | covered | `server/test/resourceRepositories.test.ts` — classification test asserts detached, no-upstream, ahead, and diverged states lack update tokens. |
| `agent-resource-management / A repository that is no longer there` | covered | `server/test/resourceRepositories.test.ts` — failed/removed/replaced test removes and replaces repositories and asserts unavailable assessments. |
| `agent-resource-management / One refresh fails among several` | covered | `server/test/resourceRepositories.test.ts` — the same test asserts a failed remote is isolated while other assessments complete. |
| `agent-resource-management / Eligible repository is updated` | covered | `server/test/resourceRepositories.test.ts` — “fast-forwards the assessed commit and disables repository hooks” asserts exact HEAD advance and no hook execution. |
| `agent-resource-management / Submodule content is not silently claimed` | covered | `server/test/resourceRepositories.test.ts` — “advances a superproject without updating or initializing submodule content” asserts the submodule remains untouched. |
| `agent-resource-management / Repository changes after assessment` | covered | `server/test/resourceRepositories.test.ts` — revision/expiry/recheck test mutates HEAD and worktree after consent and asserts refusal. |
| `agent-resource-management / Concurrent updates target one repository` | covered | `server/test/resourceRepositories.test.ts` — concurrent request test asserts serialization and a stale-token refusal for the second update. |
| `agent-resource-management / Client supplies an unknown repository` | covered | `server/test/resourceRepositories.test.ts` and `server/test/agentResourcesWire.test.mjs` assert unknown IDs are refused before Git and produce a correlated error. |
| `agent-resource-management / Extension repository requires confirmation` | covered | `server/test/resourceRepositories.test.ts` — extension acknowledgement test refuses absent consent and succeeds only with revision-bound acknowledgement. |
| `agent-resource-management / Mixed repository is locked as a unit` | covered | `server/test/resourceRepositories.test.ts` — extension lock test refuses update for a repository containing any extension. |
| `agent-resource-management / Confirmation becomes stale` | covered | `server/test/resourceRepositories.test.ts` — the revision/expiry test asserts expired and changed-revision confirmations are refused. |
| `agent-resource-management / Affected workspace is busy` | covered | `server/test/agentResourcesWire.test.mjs` — busy-workspace test asserts refusal occurs before remote HEAD is applied. |
| `agent-resource-management / Shared repository reloads all affected idle workspaces` | covered | `server/test/agentResourcesWire.test.mjs` — shared-repository test asserts both sessions are rebuilt and both receive inventories with additions/removals. |
| `agent-resource-management / Reload fails after Git succeeds` | covered | `server/test/agentResourcesWire.test.mjs` — partial-failure test asserts Git stays advanced and the failed workspace is reported. |
| `agent-resource-management / Unstarted workspace loads later` | covered | `server/test/agentResourcesWire.test.mjs` — dormant-workspace test asserts it is not started by update and later loads the new resource. |

## API delta

| Scenario | Coverage | Assertion evidence |
|---|---|---|
| `api / AnAnswerReachesOnlyItsRequester` | covered | `server/test/agentResourcesWire.test.mjs` — refresh test uses two sockets and asserts only the requester receives the correlated answer. |
| `api / AResourceRequestIsServedForItsOwnWorkspace` | covered | `server/test/agentResourcesWire.test.mjs` — enrollment test binds two workspace clients and asserts only the requester workspace configuration changes. |
| `api / AnUnissuedIdentifierIsRefused` | covered | `server/test/agentResourcesWire.test.mjs` — unissued IDs test asserts correlated refusals; service test also proves Git never starts. |
| `api / AFailureDoesNotLeakCredentials` | covered | `server/test/agentResourcesWire.test.mjs` — credential-bearing clone test asserts the private error contains neither username nor password. |

## Components delta

| Scenario | Coverage | Assertion evidence |
|---|---|---|
| `components / Open repository-first resource manager` | covered | `ui/src/components/AgentResourceManager.test.tsx` — repository-first split test asserts grouped repositories, details, counts, and unavailable resources. |
| `components / Settings delegates resource changes to the dialog` | covered | `ui/src/components/SettingsMenu.test.tsx` — resource-management entry-point tests assert one “Manage agent resources” button opens the dialog and receives focus back on close. |
| `components / Add repository previews roots before applying` | covered | `ui/src/components/AgentResourceManager.test.tsx` — clone workflow test asserts preview is requested before selected roots can be enrolled. |
| `components / Git repository form suggests but does not fix the destination` | covered | `ui/src/components/AgentResourceManager.test.tsx` — clone test asserts a suggestion is adopted and remains editable; parent-picker test preserves the custom leaf name. |
| `components / Add local folder remains available` | covered | `ui/src/components/AgentResourceManager.test.tsx` — separate local skill and extension tests drive both picker flows. |
| `components / Search and attention filters preserve repository context` | covered | `ui/src/components/AgentResourceManager.test.tsx` — filter test asserts a mixed repository exposes only matching resources and counts while hidden selection falls back safely; `e2e/settings-extensions.spec.ts` repeats the kind-filter transitions and rapid clicks in the running app. |
| `components / Dirty repository directs resolution outside the app` | covered | `ui/src/components/AgentResourceManager.test.tsx` — dirty test asserts external-resolution guidance and no update control. |
| `components / Extension confirmation precedes update callback` | covered | `ui/src/components/AgentResourceManager.test.tsx` — revision-specific confirmation test asserts no update before confirmation and exact acknowledged revision after it. |
| `components / Selection changes during an operation` | covered | `ui/src/components/AgentResourceManager.test.tsx` — in-flight result test switches selection and asserts the result remains keyed to its repository. |
| `components / A selected repository the server no longer knows` | covered | `ui/src/components/AgentResourceManager.test.tsx` — stale-identity test removes the selected repository and asserts safe fallback. |
| `components / Provenance-unavailable resources stay visible` | covered | `ui/src/components/AgentResourceManager.test.tsx` — repository-first test asserts the unavailable pseudo-group and its resource stay visible. |

## Config delta

| Scenario | Coverage | Assertion evidence |
|---|---|---|
| `config / ALockedServerRefusesTheChange` | covered | `server/test/extensionPathsWire.test.mjs` — locked deployment test sends an extension-path mutation and asserts refusal. |
| `config / TheLockIsReportedToClients` | covered | `server/test/extensionPathsWire.test.mjs` and `ui/src/components/SettingsMenu.test.tsx` assert the snapshot lock and disabled/hidden extension controls. |
| `config / TheLockLeavesSkillPathsAlone` | covered | `server/test/extensionPathsWire.test.mjs` — locked deployment test asserts a skill-path change still persists. |
| `config / Locked extension repository cannot be updated` | covered | `server/test/resourceRepositories.test.ts` — extension lock test asserts the repository update is refused server-side before Git. |
| `config / Lock still permits repository inspection` | covered | `server/test/agentResourcesWire.test.mjs` — locked mixed preview remains inspectable while enrollment filters extensions. |

## Git delta

| Scenario | Coverage | Assertion evidence |
|---|---|---|
| `git / RepoLargerThanRoot` | covered | `server/test/git.test.ts` — larger-repository suite asserts paths are reported relative to the browser root. |
| `git / PathEscapeRefused` | covered | `server/test/git.test.ts` — path-confinement tests reject revision/file-history escape. |
| `git / MalformedSha` | covered | `server/test/git.test.ts` — malformed revision tests reject invalid SHA-like input. |
| `git / PathLookingLikeOption` | covered | `server/test/git.test.ts` — leading-dash filename test asserts it is treated as a path, not an option. |
| `git / RepositoryRootOutsideTheBrowserRootIsNeverACwd` | covered | `server/test/git.test.ts` — larger-repository tests assert scoped operations and the updater observer test below pins resource-only authority. |
| `git / Resource updater does not expand workspace Git authority` | covered | `server/test/resourceRepositories.test.ts` — Git observer assertions require every updater command cwd to be the enrolled repository and never the workspace root. |

## Applicable main-spec scenarios

These existing contracts are directly touched by the new surface and remain covered.

| Scenario | Coverage | Assertion evidence |
|---|---|---|
| `Persist an interactive skill-path update` | covered | `server/test/agentResourcesWire.test.mjs` enrollment and `server/test/extensionPathsWire.test.mjs` locked update assert persisted skill paths and rebuilt inventory. |
| `TheTwoListsLoadTogether` | covered | `server/test/extensionPathsWire.test.mjs` asserts the restarted server loads configured skills/extensions together. |
| `ADirectoryIsAValidExtensionPath` | covered | `server/test/extensionPathsWire.test.mjs` loads an extension from the selected directory through the real runtime. |
| `BothListsAreReadExceptionsToTheSandbox` | covered | `server/test/extensionPathsWire.test.mjs` exercises configured roots outside the workspace through the running server; `server/test/sandboxSettingsWire.test.mjs` — the two `ReadConfiguredResourceOutsideRoot` cases assert the replacement agent's real `read` tool returns a skill and an extension configured outside the sandbox root. |
| `New sandbox governs the replacement session` | covered | `server/test/sandboxSettingsWire.test.mjs` — “moving the sandbox in Settings moves the file browser and the agent's real `ls` tool” asserts the directory listing and the replacement agent's tool output both name the new root and no longer the old one; `server/test/embeddedRuntime.test.ts` pins the factory that survives a post-handoff binding failure; `e2e/settings-sandbox.spec.ts` repeats the move in the running app. |
| `ALockedServerRefusesTheChange` | covered | `server/test/extensionPathsWire.test.mjs` asserts the server rejects extension mutations under lock. |
| `TheLockIsReportedToClients` | covered | `server/test/extensionPathsWire.test.mjs` and `ui/src/components/SettingsMenu.test.tsx` assert wire and UI lock state. |
| `TheLockLeavesSkillPathsAlone` | covered | `server/test/extensionPathsWire.test.mjs` asserts skill updates remain accepted under extension lock. |
| `TheSnapshotNamesTheUsersOwnPaths` | covered | `server/test/extensionPathsWire.test.mjs` asserts the snapshot carries the effective configured resource inventory and capabilities. |
| `AnUnknowableInventoryIsNotReportedAsEmpty` | covered | `server/test/extensionPathsWire.test.mjs` and `server/test/pi-rpc.test.ts` assert unavailable provenance is distinct from an empty inventory. |
| `RepoLargerThanRoot`, `PathEscapeRefused`, `MalformedSha`, `PathLookingLikeOption`, `RepositoryRootOutsideTheBrowserRootIsNeverACwd` | covered | The corresponding `server/test/git.test.ts` assertions cited in the Git delta table cover the modified main requirements at their production boundary. |
