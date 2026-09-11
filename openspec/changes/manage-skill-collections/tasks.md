## 1. Configuration and the runtime feed

- [x] 1.1 Add `userSkillCollections` (`{ path, managed, enabledSkills }[]`) to `AppConfig`, `loadConfig` validation (absolute resolution, POSIX relative entries, no `..`, no duplicates) and `EditableSettings`/`persistEditableSettings` under its own key; verify with `server/test/skillCollections.test.ts` cases (written, then read back through `loadConfig` as the next boot would) for a round-trip restart and for a configuration-file `skillPaths` entry surviving a collection write
- [x] 1.2 Extend `allSkillPaths` to append each enabled collection skill directory that still exists inside its worktree and contains `SKILL.md`, after `skillPaths` and `userSkillPaths`; verify with a config unit test (order, missing directory dropped, path escaping the worktree dropped) and an `rpc-resource-args.test.ts` case showing one `--skill` per enabled directory
- [x] 1.3 Prove the sandbox read-only roots follow: an enabled skill outside `sandbox.root` is readable and not writable by the session's tools, a disabled one is not readable; verify in `server/test/skillCollectionsWire.test.mjs` (booted server, the agent's own read tool)
- [x] 1.4 Confirm a configuration carrying `userSkillCollections` still loads through the previous release's `loadConfig` (downgrade path) and record the result in the PR

## 2. Skill catalogue

- [x] 2.1 Implement `discoverSkillCatalogue(worktree)` in `server/src/resourceRepositories.ts`: `readdir`/`lstat` walk, no symlinks, skip `.git`/`node_modules`, stop at a directory holding `SKILL.md`, depth ≤ 8, ≤ 2,000 skills, ≤ 16 KiB read per file, frontmatter via pi's `parseFrontmatter`, group = parent path relative to the worktree; verify with `skillCatalogue.test.ts` on a fixture shaped like claude-skills-collection (category folders + prefixed `skills/` copies, a root `SKILL.md`, a manifest whose categories differ from the folders)
- [x] 2.2 Cover the catalogue's refusals and bounds: symlinked skill directory inside and outside the worktree contributes nothing, count and depth bounds are reported with their limit, duplicates are both listed, a repository with a top-level-side-effect extension triggers nothing; verify each as its own test in `skillCatalogue.test.ts`

## 3. Enrollment

- [x] 3.1 Extend `AgentResourceRepositoryPreview` with `skills` and `bound`, include the catalogue in the preview fingerprint, and accept a clone with catalogued skills but no skill root; verify that a changed catalogue between preview and confirmation is refused and that a clone with neither skills nor extension roots is still refused
- [x] 3.2 Record `managed: true` when `cloneAndPreview` created the folder (not when it reused an existing clone), and accept `enabledSkills` in `enroll_agent_resource_repository`: validate against the fresh catalogue, persist the collection entry through `handleUpdateConfig`, allow an empty selection; verify in `collectionEnrollmentWire.test.mjs` (and `collectionEnrollment.test.ts` for refusals and the managed flag) that enrolling with nothing on loads no collection skill and enrolling with one on loads exactly that one
- [x] 3.3 Re-enrollment: a worktree already registered as a collection merges new extension roots and skills and keeps skills already on; a worktree already registered through user skill roots stays in root mode; verify both in `collectionEnrollmentWire.test.mjs`

## 4. Inventory

- [x] 4.1 Add a declared collection's worktree to the inventory even when nothing from it is loaded, and attach `collection` (groups, skills with `off`/`on-loaded`/`on-not-loaded`/`on-missing`, reason, bound) by joining catalogue, persisted selection and runtime resources; verify with `collectionInventory.test.ts` cases for each state, including a name collision between two enabled copies
- [x] 4.2 Attach `removal` (`allowed`, `deletesFiles`, `path`, `reason`) to every repository: refused with a reason when any of its paths is configuration-file declared, `deletesFiles` only for managed clones; verify with `collectionInventory.test.ts` cases for a managed clone, an unmanaged clone, managed storage, a configured path, and a vanished folder

## 5. Selection and removal on the server

- [x] 5.1 Extract the affected-workspace reservation from `handleUpdateAgentResourceRepository` into a helper without changing update behaviour; verify the existing update tests still pass unchanged
- [x] 5.2 Add `set_agent_resource_skills` (protocol, message allowlist, handler): known id only, full set validated against a fresh catalogue, reservation, `handleUpdateConfig`; verify in `collectionSelectionWire.test.mjs`: one skill on loads it alone, all on / all off, per-group set, outside-catalogue path / `..` path / unknown id refused with nothing persisted, busy workspace refused naming it, refused replacement keeps the previous selection, RPC runtime refused
- [x] 5.3 Prove update semantics: after a fast-forward that adds a skill directory, the new skill is `off` and previously enabled skills stay on; after one that deletes an enabled skill, it is `on-missing` and not passed to the runtime; verify in `collectionSelectionWire.test.mjs` with a local upstream
- [x] 5.4 Add `remove_agent_resource_repository` → `agent_resource_removed`: reserve, unregister collection entry and every user skill/extension root inside the worktree through `handleUpdateConfig`, then under the repository mutex delete only when canonical path = registered worktree = Git top level, managed (flag or inside `managedRoot`), not a filesystem root and not `managedRoot`; verify in `collectionRemovalWire.test.mjs`: managed clone deleted, unmanaged clone kept with `removed-files-kept`, configured path refused, unknown id refused, busy refused, refused replacement leaves registration and files
- [ ] 5.5 Make deletion safe and honest across platforms: symlink out of the clone leaves its target untouched; on EPERM/EACCES clear read-only attributes and retry; a remaining failure yields `removed-delete-failed` with the path; verify in `cloneDeletion.test.ts` including a read-only directory and a forced failure, and watch the Windows CI job pass

## 6. Agent resources dialog

- [x] 6.1 Render a collection's skills grouped by folder with collapsible groups, per-group on-count, and a switch per skill showing the four states with reasons; verify in `AgentResourceManager.test.tsx`
- [x] 6.2 Add repository-level **All on** / **All off** and per-group all on / all off that edit a per-repository pending set, with pending count, **Apply** (one callback with the complete set) and **Discard**; keep the pending set per repository id, rebase it on a new inventory for the same id, drop it for a vanished id; verify each behaviour as its own test, including switching repositories and back
- [x] 6.3 Use the same grouped catalogue, all off, in the Add Git repository preview and send its pending set as `enabledSkills`; verify a test that confirms with nothing on and one with two skills on
- [x] 6.4 Add **Remove repository** with an irreversible-action confirmation naming the path (or saying files are kept when unmanaged), no action and a reason for configured repositories, and callback only after confirm; verify confirm, cancel, unmanaged and configured cases
- [x] 6.5 Wire the new messages through `ui/src/useAgent.ts` and `ui/src/App.tsx` (operation state correlated by request id and repository id, results never shown under another repository); verify in `useAgent.test.ts`

## 7. Documentation

- [x] 7.1 Update `docs/how-to.md` and the README resources section: collections start with every skill off, per-skill and bulk switches, Apply, and that Remove repository deletes a managed clone from disk; check the links and commands they cite

## 8. Verification

- [x] 8.1 Write `openspec/changes/manage-skill-collections/scenario-coverage.md` mapping every scenario (`rg '^#### Scenario:' openspec/changes/manage-skill-collections`) to a test whose assertion would fail if the contract broke; run `npm run check:scenarios`
- [x] 8.2 Run `npm run lint`, the server and UI suites, and `openspec validate manage-skill-collections --strict`; all pass
- [x] 8.3 Rebuild `web`, `@pi-outpost/embed` and `build:e2e-host`, run `npm run bench`, and with Playwright enroll claude-skills-collection: check the groups in the DOM, turn on two skills and read the session's skill list, All on / All off, then Remove repository and confirm the clone is gone from disk
- [x] 8.4 Monkey pass on the bench: double-click Apply, toggle while an apply is in flight, switch repositories with pending changes, remove a repository while a turn is streaming, delete the clone on disk under the running app then open the dialog, rapid All on / All off; report what broke and fix what is in scope

## Notes from the running-app passes (8.3, 8.4)

- Enrolling the real claude-skills-collection: 696 skills in 35 folder groups, all off; two turned on,
  both reported Loaded; the config file held exactly those two; Remove repository deleted the clone.
- Found and fixed there, neither caught by the suites at the time: the snapshot of the session
  replacement a resource operation causes reset every pending operation, so the answer (removal
  banner, enrollment result, apply error) was dropped — `applySnapshot` now clears them only on
  `hello` and `workspace_switched`, with a `useAgent.test.ts` regression test. And the Work Plan
  session sync was queued only after the inventory refresh, so a replacement awaiting it could run
  ahead of the inherited plan — slower inventory builds exposed it in `work-plan-server.test.mjs`;
  `queueWorkPlanSessionSync` now takes the refresh as a dependency inside its chain.
- Monkey pass: pending changes stayed with their repository across switches; ten rounds of
  All on / All off left a consistent state; a double-clicked Apply applied once; switches are
  disabled while an apply is in flight; a double-clicked Remove opened one confirmation.
- Left open: after a clone is deleted under the running app, Refresh all marks the repository
  Unavailable but its skill list stays the last inventory's until the next rebuild. Removing it
  still works and says so. Removal during a streaming turn is not drivable on the offline bench;
  `collectionRemovalWire.test.mjs` covers that refusal.
- User review after 8.4 found what the scripted passes had not: a skill turned on could not be found
  among 696 (large collections opened folded, the only open folder held 348 rows), and the repository
  was named after its local clone folder. Fixed: repositories are named after their `origin`; the
  skills that are on are listed above the folders with Turn off; Search skills and Only on narrow the
  list; the repository list reads "N on · total"; descriptions clamp to two lines (the embedded build
  had no `line-clamp` utility). Re-checked on the bench from what the screen shows, with screenshots.
- Still worth a look: copies of one skill in two folders (`skills/writing-changelog-writer`,
  `writing-skills/changelog-writer`) look identical, and nothing warns that turning both on loads it
  twice — left as the repository ships them, per the no-dedupe decision.
