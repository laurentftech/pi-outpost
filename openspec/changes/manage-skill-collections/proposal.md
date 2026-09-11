## Why

A Git repository that carries a large collection of skills cannot be managed through the Agent
resources dialog. Enrolling one activates a whole skill root at once — for
`khalilbenaz/claude-skills-collection` that is 348 skills pushed into every system prompt — and the
only thing the dialog can take back is that root. The collection's own organisation (34 category
folders) is never shown, because discovery offers only the repository root, `skills/` and
`.agents/skills`. A collection is useful when a reader can keep the ten skills they want out of
hundreds; today it is all or nothing, and getting rid of it leaves the clone on disk.

## What Changes

- **Skills of a newly enrolled Git repository are off by default.** Enrolling registers the
  repository and its catalogue of skills; nothing from it loads until the user turns a skill on.
  Each skill can be turned on or off individually.
- **Bulk switches.** The selected repository offers **All on** and **All off**; each folder group
  inside it offers the same pair for its own skills.
- **Skills are grouped the way the repository lays them out.** The catalogue lists every `SKILL.md`
  in the repository (bounded walk), grouped by the folder that contains the skill, named by its
  path from the repository root. No repository-specific manifest (`skills.json`,
  `marketplace.json`) is consulted. Duplicates are shown as the repository ships them; nothing is
  deduplicated.
- **Only what is turned on is loaded.** The runtime receives each enabled skill's directory as an
  individual skill path, in place of the whole root. A skill that appears later through a
  repository update stays off until the user turns it on.
- **Remove repository.** One action unregisters every path and every enabled skill of a repository
  and deletes its clone from disk, after an explicit confirmation. **BREAKING** against the current
  rule that removing a repository's last path "SHALL NOT delete the managed clone". Files are
  deleted only for a clone pi-outpost manages; a repository the user pointed at elsewhere is
  unregistered and its files are kept, and the dialog says so.
- **Existing registrations are unchanged.** Repositories already enrolled through skill roots keep
  loading everything under those roots; there is no migration. Add local folder is unchanged.
  Extensions keep today's root-based enrollment.

## Capabilities

### New Capabilities

None — this extends the existing resource-management capability.

### Modified Capabilities

- `agent-resource-management`: enrollment of a Git repository registers a skill catalogue with
  every skill off instead of activating skill roots; adds per-skill enablement with repository-level
  and folder-level bulk switches, folder-tree grouping, and whole-repository removal that deletes a
  managed clone.
- `components`: `AgentResourceManager` renders a collection repository's skills grouped by folder
  with per-skill switches, **All on** / **All off** at repository and folder level, staged changes
  applied together, and a **Remove repository** action behind an irreversible-action confirmation.
- `persistent-runtime-settings`: the enabled-skill selection of each collection is persisted under
  its own key, survives a restart, and — like any changed skill path — replaces the session when it
  changes.

## Impact

- `server/src/resourceRepositories.ts` — skill catalogue discovery (bounded walk of every
  `SKILL.md`, frontmatter name and description), collection-aware preview and confirmation,
  repository removal with confined deletion.
- `server/src/config.ts` — new persisted key for collections and their enabled skills;
  `allSkillPaths` gains the enabled skill directories, which carries them to the embedded loader,
  to RPC `--skill` arguments and to the sandbox's read-only resource exceptions through the
  existing call sites.
- `server/src/index.ts` — new client messages (set enabled skills, remove repository), reuse of the
  affected-workspace reservation used by updates, session replacement and rollback through
  `handleUpdateConfig`.
- `shared/src/protocol.ts` — preview carries a skill catalogue; inventory repositories carry
  collection state (skills, groups, enabled, loaded, removable, managed); two new client messages.
- `ui/src/components/AgentResourceManager.tsx`, `ui/src/useAgent.ts`, `ui/src/App.tsx` — grouped
  catalogue, switches, bulk actions, staged apply, remove confirmation.
- Tests: `server/test/resourceRepositories.test.ts`, `server/test/agentResourcesWire.test.mjs`,
  `server/test/settings-persistence.test.mjs`, `ui/src/components/AgentResourceManager.test.tsx`;
  a running-app check on the bench.
- Runtime: selective enablement works on the embedded runtime; the RPC runtime already refuses
  runtime-settings changes and keeps doing so.
- Docs: `docs/how-to.md` and the README's resources section describe enrollment and removal.
