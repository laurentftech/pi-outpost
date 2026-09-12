## Context

See proposal.md — Why. The relevant current state:

- Enrollment (`ResourceRepositoryService.cloneAndPreview` → `confirmPreview` in
  `server/src/resourceRepositories.ts`, `handleEnrollAgentResourceRepository` in
  `server/src/index.ts`) persists **roots**: `discoverResourceRoots` offers the repository root
  (only when `SKILL.md` sits directly there), `skills/` and `.agents/skills`, and a confirmed root is
  appended to `userSkillPaths`. For `claude-skills-collection` that is `skills/` alone — 348 skills
  in one switch — while its 34 category folders are never offered.
- Every explicit skill path reaches the runtime through one function, `allSkillPaths(config)`
  (`server/src/config.ts`), whose callers are the embedded loader's `additionalSkillPaths`
  (`index.ts` ~981), RPC `--skill` arguments (`rpcResourceArgs.ts`), and the sandbox's read-only
  resource roots (`index.ts` 1170 and 2325).
- The inventory is built from what the **runtime loaded** plus declared roots
  (`normalizeResources`, `buildInventory`), grouped by enclosing Git worktree. A skill that is not
  loaded is invisible to it.
- Settings changes go through `handleUpdateConfig`, which persists (`persistEditableSettings`,
  atomic, validated through `loadConfig`), replaces the session, and rolls everything back when the
  replacement is refused. On a runtime without `rebuildTools` (RPC) it refuses the change outright.
- Repository updates reserve every affected workspace (`affectedResourceWorkspaces` +
  `reserveAffected` in `handleUpdateAgentResourceRepository`) so no turn or session change can
  interleave with a Git mutation.
- pi 0.85.1: `loadSkillsFromDir` treats a directory containing `SKILL.md` as one skill root and does
  not recurse further, so a skill's own directory loads exactly that skill. `parseFrontmatter` is
  exported. Pi keeps the first skill it meets under a name and reports the rest as collisions.
  Pi settings accept `!pattern` / `-path` exclusions, and `DefaultResourceLoader` has a
  `skillsOverride` hook.

## Goals / Non-Goals

**Goals:**
- A collection repository costs nothing in the prompt until the user turns skills on.
- One source of truth for which skill paths a session receives, shared by both runtimes and the
  sandbox, so a skill that is on is also readable and a skill that is off is neither loaded nor
  granted.
- Removal deletes a managed clone and never anything else.

**Non-Goals:**
- Per-skill control for Add local folder, for configuration-file skill paths, or for repositories
  enrolled before this change (they keep root semantics; no migration).
- Per-extension enablement. Extensions keep root-based enrollment.
- Selective enablement on the RPC runtime — it already refuses runtime-settings changes.
- Reading repository manifests (`skills.json`, `marketplace.json`, bundles) for grouping.
- Deduplicating skills across folders.

## Decisions

### 1. An allowlist of enabled skill directories, persisted per repository

New configuration key, written only by the interface:

```json
"userSkillCollections": [
  { "path": "/abs/worktree", "managed": true, "enabledSkills": ["dev-skills/react-component-builder"] }
]
```

`enabledSkills` holds POSIX paths relative to the worktree, one per skill directory. `managed`
records that pi-outpost's clone operation created the folder (a reused existing clone is not
`managed` unless it lies inside managed storage — see 6).

*Alternatives.* **pi exclusions** (`-path`, `!pattern` in a skills array): default-off would need an
exclusion per skill, and a skill added by an update would load by default — the opposite of the
requirement. **`skillsOverride`**: embedded-only, filters by name after everything was loaded and
parsed, and a name is not a stable identity across two copies of the same skill. **Enabled
directories appended to `userSkillPaths`**: loses which repository a path belongs to, so removal,
grouping and "all off" would have to be reconstructed from path prefixes, and it would mix root
semantics with skill semantics in one key. A separate key keeps old registrations untouched, which
is what "only new repositories" requires.

### 2. `allSkillPaths` is the single feed

`allSkillPaths(config)` returns `[...skillPaths, ...userSkillPaths, ...enabledCollectionSkillDirs]`,
where the last part resolves each enabled entry against its worktree and keeps it only when the
directory still exists inside the worktree and contains `SKILL.md`. Because every consumer already
calls this function, the embedded loader, RPC arguments and sandbox read-only roots all follow
without further wiring. Collections come last, so a configuration-file or user skill keeps winning
a name collision, as it does today.

Passing each skill's **directory** (not its `SKILL.md`) matches pi's own discovery rule — a
directory with `SKILL.md` is one skill, no recursion — and makes the read-only sandbox exception
cover the skill's supporting files.

### 3. Catalogue: a bounded walk parsed by pi's own frontmatter parser

`discoverSkillCatalogue(worktree)` walks the canonical worktree with `readdir` + `lstat`: no
symlinks, skip `.git` and `node_modules`, stop descending into a directory once it holds `SKILL.md`
(pi's rule), depth ≤ 8, at most 2,000 skills, at most 16 KiB read per `SKILL.md`. Frontmatter is
parsed with pi's exported `parseFrontmatter`, so the name shown is the name the runtime will use.
Group = POSIX path of the skill directory's parent relative to the worktree; `""` is displayed as
the repository name. Reaching a bound sets `catalogueBound: { kind, limit }` on the result.

The walk is cheap enough (≈700 directories for the example) to rerun on every inventory build and
on every selection change; no cache, so an external change to the worktree is seen on the next
rebuild.

*Alternative.* Reusing `loadSkillsFromDir` on the worktree root: unbounded, follows pi's own rules
for root `.md` files, and returns skills without the folder structure we need to group by.

### 4. Inventory carries collection state

`AgentResourceRepository` gains:

```ts
collection?: {
  groups: Array<{ path: string; label: string }>;
  skills: Array<{
    relativePath: string; name: string; description?: string; group: string;
    state: "off" | "on-loaded" | "on-not-loaded" | "on-missing"; reason?: string;
  }>;
  bound?: { kind: "depth" | "count"; limit: number };
};
removal: { allowed: boolean; deletesFiles: boolean; path: string; reason?: string };
```

A declared collection creates its repository group even when nothing is loaded (it is added to
`normalizeResources`' declared entries the way an unrepresented root is today). State is computed by
joining the fresh catalogue, the persisted `enabledSkills`, and the runtime's reported resources by
canonical skill directory. An enabled entry missing from the catalogue is `on-missing`; an enabled
entry the runtime did not report is `on-not-loaded`, with the collision or rejection message when
the runtime's diagnostics carry one.

### 5. Protocol

- `AgentResourceRepositoryPreview` gains `skills` (catalogue entries, all off) and `bound`; the
  preview fingerprint covers the catalogue as well as the roots.
- `enroll_agent_resource_repository` gains `enabledSkills: string[]`. `skillRoots` remains for
  re-enrolling a worktree already registered through roots.
- New `set_agent_resource_skills { repositoryId, enabledSkills, requestId }` — the complete set that
  should be on for one repository. Sending a full set makes the request idempotent and serves
  per-skill, per-group and repository-wide changes with one message.
- New `remove_agent_resource_repository { repositoryId, requestId }`, answered by
  `agent_resource_removed { requestId, result, inventory }` with
  `result.status: "removed" | "removed-files-kept" | "removed-delete-failed"` and the path.
- Errors keep using `agent_resource_error`.

### 6. Selection and removal ride on `handleUpdateConfig`

`EditableSettings` and `handleUpdateConfig` gain `userSkillCollections`. Selection changes and
removals call it, so persistence, validation-by-`loadConfig`, session replacement, rollback on a
refused replacement, and the RPC refusal are all inherited instead of re-implemented. The server
validates a requested set by rebuilding the catalogue and refusing any entry not in it.

The affected-workspace reservation used by updates is extracted from
`handleUpdateAgentResourceRepository` into a helper and reused, so a selection change or removal is
refused while a consumer is streaming or replacing its session, and nothing can start in between.

Removal order: reserve → unregister (collection entry, user skill roots and user extension roots
inside the worktree) through `handleUpdateConfig` → on handoff, delete → rebuild inventory. The clone
is deleted only when all of these hold at that moment: its canonical path equals the registered
worktree and is Git's `--show-toplevel` for it; it is `managed: true` **or** lies inside
`managedRoot`; it is neither a filesystem root nor `managedRoot` itself. Deletion uses `fs.rm`
recursively, which unlinks symbolic links rather than following them. Deletion runs under the
repository mutex (`repositoryLocks`) so it cannot interleave with a refresh or update.

*Alternative.* Delete first, then unregister: a live session would briefly point at vanished files,
and a refused replacement could not be rolled back — the files would be gone.

### 7. The dialog stages changes and applies them together

Each apply replaces the session. Applying on every switch click would replace it once per click,
and a click landing during the previous replacement would be refused as busy. The dialog therefore
keeps a pending set per repository id, shows the pending count with **Apply** and **Discard**, and
sends one `set_agent_resource_skills` with the complete resulting set. **All on / All off** (repository)
and the per-group pair only edit the pending set. A new inventory for the same repository rebases the
pending set on the supplied state instead of dropping it; a vanished repository id drops it. The
preview uses the same component with everything off, and its confirmation sends the pending set as
`enabledSkills`.

## Risks / Trade-offs

- [Deleting the wrong directory] → deletion needs a registered worktree, canonical equality with
  Git's top level, and managed ownership; refuses roots and `managedRoot`; symlinks are unlinked,
  not followed. Tests cover a symlink out of the clone, a clone outside managed storage, and a
  forged repository id.
- [Windows: Git's read-only object files make `fs.rm` fail with EPERM] → clear the read-only
  attribute and retry on EPERM/EACCES; a remaining failure is reported as `removed-delete-failed`
  with the path. Checked on the Windows CI runner.
- [All on for a 700-skill repository makes a very large prompt] → it is the user's explicit choice;
  the repository shows how many skills are on so the size is visible before applying.
- [Name collisions between copies of the same skill] → pi keeps the first; the other is
  `on-not-loaded` with the collision reason, so the user sees why rather than guessing.
- [Catalogue walk on every rebuild] → bounded by depth and count; worst case is ~2,000 small reads
  capped at 16 KiB each.
- [A legacy root-enrolled repository and a collection on the same worktree] → re-enrolling a
  root-registered worktree stays in root mode, so one worktree is never both.

## Migration Plan

No migration: existing `userSkillPaths` entries keep loading everything. The new key is additive and
is only written once a collection is enrolled. A downgrade to a version that ignores the key leaves
collection skills unloaded, their clones on disk, and the rest of the configuration working
(confirmed by loading a configuration carrying the key through the previous `loadConfig`).
Rollback is removing the key.
