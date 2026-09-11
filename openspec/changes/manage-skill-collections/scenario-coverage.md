# Scenario coverage — manage-skill-collections

Every `#### Scenario:` this change's deltas declare, matched to the assertion that would fail if the
contract broke. Sixty-eight scenarios: thirty-nine in `agent-resource-management` (twenty-seven
added, twelve carried by the modified `Repository enrollment`), twenty-four in `components` (thirteen
added, eleven carried by the modified `AgentResourceManager`), five added in
`persistent-runtime-settings`.

Enumerated with `rg '^#### Scenario:' openspec/changes/manage-skill-collections/specs/`.

The server scenarios are asserted at the boundary the spec names: a booted server over its real
socket, reading back what the replacement session loaded (its reported resources), what reached the
configuration file, and what is on disk. The one seam is deletion failure, which no portable fixture
can force — `useResourceRemover` makes `rm` fail on demand and the test asserts what the service then
reports. Dialog scenarios are asserted on the rendered component; the running-app walkthrough is
recorded under tasks 8.3 and 8.4.

## agent-resource-management

| Scenario | Coverage | Assertion evidence |
|---|---|---|
| Category folders become groups | covered | `server/test/skillCatalogue.test.ts` — “category folders become groups” builds a fixture shaped like claude-skills-collection (category folders plus prefixed `skills/` copies) and asserts every skill with its folder group, path and frontmatter name. |
| Duplicates are listed as shipped | covered | `server/test/skillCatalogue.test.ts` — “duplicates are listed as shipped” asserts both copies of one skill are listed, each in its own group, even under one name. |
| No manifest decides the grouping | covered | `server/test/skillCatalogue.test.ts` — “a manifest has no effect on the grouping” ships a skills.json manifest whose category differs and asserts the groups are exactly the folders. |
| Cataloguing runs no repository code | covered | `server/test/skillCatalogue.test.ts` — “cataloguing runs no repository code” plants an extension and a skill helper that write a marker when imported and asserts the marker never appears. |
| A symlinked skill is not followed | covered | `server/test/skillCatalogue.test.ts` — “a symlinked skill contributes nothing, inside or outside the worktree” asserts only the real directory is listed. |
| A catalogue that reaches its bound says so | covered | `server/test/skillCatalogue.test.ts` — the count-bound and depth-bound tests assert the result names the bound and its limit. |
| A newly enrolled collection loads nothing | covered | `server/test/collectionEnrollmentWire.test.mjs` — “a collection enrolled with nothing on loads none of its skills” asserts the catalogue is previewed, no skill from the clone is loaded, and the collection is persisted with an empty selection. |
| Turning one skill on loads that skill alone | covered | `server/test/collectionSelectionWire.test.mjs` — “one skill, all on, one group, all off…” first step asserts the replacement session loads `rust` and nothing else from the repository; `server/test/skillCollectionsWire.test.mjs` asserts the off skill is not loaded at boot. |
| All on and all off for the repository | covered | `server/test/collectionSelectionWire.test.mjs` — the same test asserts every catalogued skill is loaded after the full set, and none after the empty set, with the persisted selection read back. |
| All on for one folder group | covered | `server/test/collectionSelectionWire.test.mjs` — the same test applies the `dev-skills` set and asserts exactly `react` and `rust` are loaded. |
| A selection outside the catalogue is refused | covered | `server/test/collectionSelectionWire.test.mjs` — “a selection outside the catalogue, a path leaving the repository, or an unknown id is refused” asserts each refusal, an unchanged persisted selection, and no session replacement. |
| A refused replacement keeps the previous selection | covered | `server/test/collectionSelectionWire.test.mjs` — “a vetoed replacement keeps the previous selection” uses a real vetoing extension and asserts the persisted selection and the retained session's loaded skills are unchanged. |
| A busy workspace blocks a selection change | covered | `server/test/collectionSelectionWire.test.mjs` — “a busy workspace loading the collection blocks a selection change, naming it” streams a turn in another project and asserts the refusal names it and nothing is persisted. |
| A skill added by an update stays off | covered | `server/test/collectionSelectionWire.test.mjs` — “an update adds a skill that stays off…” fast-forwards a new skill in and asserts it is `off` while the enabled one stays `on-loaded`. |
| A skill that is on but gone is reported missing | covered | `server/test/collectionSelectionWire.test.mjs` — the same test deletes the enabled skill upstream and asserts it is `on-missing` and not loaded; `server/test/collectionInventory.test.ts` — “each state…” asserts the missing state and its reason. |
| A skill that is on but not loaded says so | covered | `server/test/collectionInventory.test.ts` — “two enabled copies under one name: the one not loaded names the winner” asserts `on-not-loaded` with a reason naming the loaded copy's path. |
| A root-enrolled repository keeps loading everything | covered | `server/test/skillCollections.test.ts` — “collections come after the configured and user paths” asserts a user skill root is still handed to the runtime whole; `server/test/collectionEnrollmentWire.test.mjs` — “a worktree already registered through a skill root is previewed in root mode” asserts it keeps root enrollment. |
| Removing a managed collection deletes its clone | covered | `server/test/collectionRemovalWire.test.mjs` — “removing a collection pi-outpost cloned unregisters it and deletes the clone” asserts `removed`, the folder gone from disk, the persisted entry gone, and nothing from it loaded. |
| A repository outside managed storage keeps its files | covered | `server/test/collectionRemovalWire.test.mjs` — “removing a repository pi-outpost does not manage keeps its files and says so” asserts `removed-files-kept` with the path and reason, the files present, and the entry unregistered. |
| A configuration-file path blocks removal | covered | `server/test/collectionRemovalWire.test.mjs` — “a repository supplying a configuration-file path is refused…” asserts the refusal, the clone present and the entry kept; `server/test/collectionInventory.test.ts` asserts `removal.allowed` is false with the reason. |
| Removal is refused while a consumer is busy | covered | `server/test/collectionRemovalWire.test.mjs` — “removal is refused while a workspace loading the repository is busy” asserts the refusal names the busy project and nothing is unregistered or deleted. |
| A refused replacement keeps the repository | covered | `server/test/collectionRemovalWire.test.mjs` — “a vetoed replacement keeps the repository registered and its files on disk” asserts the persisted entry and the clone are both intact. |
| Deletion never leaves the worktree | covered | `server/test/cloneDeletion.test.ts` — “a symbolic link out of the clone is unlinked, its target untouched” and “a folder reached through a link is kept” assert nothing outside the canonical clone is removed. |
| A failed deletion is reported as partial | covered | `server/test/cloneDeletion.test.ts` — “a deletion that fails is reported with its reason, not as done” forces `rm` to fail and asserts `failed: true`, the reason, and the files still present; `ui/src/components/AgentResourceManager.test.tsx` — “shows what removal did after the repository has left the list” asserts the partial result is shown as an alert naming the path. |
| An unknown repository is refused | covered | `server/test/collectionRemovalWire.test.mjs` — the configured-path test also sends an unissued id and asserts the refusal with the clone untouched. |
| A repository is named after its origin | covered | `server/test/collectionInventory.test.ts` — “a repository is named after its origin, not the folder it was cloned into” clones into a hash-suffixed folder, sets a credential-bearing origin, and asserts the name and that no credential reaches the inventory; `server/test/collectionEnrollment.test.ts` — “a preview names the repository after its origin, not its clone folder”. |
| A repository without an origin keeps its folder name | covered | `server/test/collectionInventory.test.ts` — “a repository without an origin keeps its folder name”. |
| Add a local skill folder | covered | `ui/src/components/AgentResourceManager.test.tsx` — “adds a local skill folder once through the picker” asserts the chosen directory is added exactly once. |
| Add a local extension folder | covered | `ui/src/components/AgentResourceManager.test.tsx` — “requires an executable warning and respects extension lock for local folders” asserts the warning gates the apply and the lock disables it. |
| Activated external resources remain readable | covered | `server/test/sandboxSettingsWire.test.mjs` — the ReadConfiguredResourceOutsideRoot cases read an outside skill and extension with the agent's real `read` tool; `server/test/skillCollectionsWire.test.mjs` does the same for an enabled collection skill and asserts a skill that is off is denied. |
| Refused replacement rolls enrollment back | covered | `server/test/sandboxSettingsWire.test.mjs` — “an extension veto rolls back the sandbox…”; `server/test/collectionSelectionWire.test.mjs` and `server/test/collectionRemovalWire.test.mjs` — the vetoed-replacement tests assert the persisted collections and the retained session are unchanged. |
| Add a repository containing skills and extensions | covered | `server/test/agentResourcesWire.test.mjs` — “repository enrollment is composed for the requesting socket workspace only” enrolls a collection skill with an extension root and asserts one mixed group with both; `server/test/collectionEnrollmentWire.test.mjs` — “a collection enrolled with one skill on loads exactly that skill”. |
| Enrollment does not execute extensions during preview | covered | `server/test/resourceRepositories.test.ts` — “previews recognized roots without executing extension modules” asserts the side-effect marker never appears. |
| Extension lock permits skill-only enrollment | covered | `server/test/agentResourcesWire.test.mjs` — “extension lock filters a mixed preview while allowing skill-only enrollment” asserts the extension root is locked and the enabled skill alone is enrolled. |
| Clone address is required and confined | covered | `server/test/resourceRepositories.test.ts` — “reuses the same-origin clone and refuses occupied or unsafe destinations before cloning” asserts every unsafe destination is refused and existing content kept. |
| Clone has no recognizable resources | covered | `server/test/resourceRepositories.test.ts` — “reports a resource-empty clone without registering paths…” asserts the refusal for a clone with neither skills nor extension roots. |
| Re-add the same repository address | covered | `server/test/resourceRepositories.test.ts` — the reuse test asserts the same checkout is reused; `server/test/agentResourcesWire.test.mjs` re-clones the same address and asserts one repository. |
| Re-enroll an existing repository | covered | `server/test/collectionEnrollmentWire.test.mjs` — “re-enrolling a collection adds skills and keeps those already on” asserts one persisted entry holding both skills and one repository group. |
| Enroll with nothing turned on | covered | `server/test/collectionEnrollment.test.ts` — “an empty selection is a valid enrollment”; `server/test/collectionEnrollmentWire.test.mjs` asserts the enrolled repository loads nothing. |

## components

| Scenario | Coverage | Assertion evidence |
|---|---|---|
| Open repository-first resource manager | covered | `ui/src/components/AgentResourceManager.test.tsx` — “opens a repository-first split inventory…” asserts grouped repositories, counts and details. |
| Settings delegates resource changes to the dialog | covered | `ui/src/components/SettingsMenu.test.tsx` — the resource-management entry-point tests assert one “Manage agent resources” button opens the dialog. |
| Add repository previews roots before applying | covered | `ui/src/components/AgentResourceManager.test.tsx` — “previews a collection with every skill off and adds it with nothing on” asserts every switch off and no enrollment until confirmed; “suggests an editable clone folder and previews before enrollment” covers the roots preview. |
| Git repository form suggests but does not fix the destination | covered | `ui/src/components/AgentResourceManager.test.tsx` — the clone test adopts and edits the suggestion; the parent-picker test keeps the custom leaf. |
| Add local folder remains available | covered | `ui/src/components/AgentResourceManager.test.tsx` — the local skill and extension tests drive both picker flows. |
| Search and attention filters preserve repository context | covered | `ui/src/components/AgentResourceManager.test.tsx` — “filters by kind and attention while preserving a matching repository context” asserts kind-filtered counts and resources. |
| Dirty repository directs resolution outside the app | covered | `ui/src/components/AgentResourceManager.test.tsx` — “directs dirty repositories to external resolution without mutation controls”. |
| Update is offered only when there is one | covered | `ui/src/components/AgentResourceManager.test.tsx` — “offers Update repository only once an update is available” asserts no Update action while unchecked or current, an enabled one when updateable, and a disabled “Updating…” while it runs; the dirty-repository test asserts none is shown there either. |
| Extension confirmation precedes update callback | covered | `ui/src/components/AgentResourceManager.test.tsx` — “confirms revision-specific executable changes before invoking update”. |
| Selection changes during an operation | covered | `ui/src/components/AgentResourceManager.test.tsx` — “keeps an in-flight result keyed to its repository…”. |
| A selected repository the server no longer knows | covered | `ui/src/components/AgentResourceManager.test.tsx` — the same test removes the selected repository and asserts the fallback. |
| Provenance-unavailable resources stay visible | covered | `ui/src/components/AgentResourceManager.test.tsx` — the repository-first test asserts the unavailable group stays listed. |
| Collection skills are grouped by folder with switches | covered | `ui/src/components/AgentResourceManager.test.tsx` — “lists a collection's skills by folder, with a switch each and an on-count per group” asserts group on-counts and switch states. |
| Skill states are distinguished | covered | `ui/src/components/AgentResourceManager.test.tsx` — “renders each state distinctly…” asserts Loaded, Not loaded with its reason, Missing with its reason, and nothing for off. |
| All on and all off stage the whole repository | covered | `ui/src/components/AgentResourceManager.test.tsx` — “stages the whole repository with All on and All off, without calling back” asserts every switch, the pending count, and no callback. |
| Folder-level all on stages one group only | covered | `ui/src/components/AgentResourceManager.test.tsx` — “stages one folder group with its own All on” asserts the other groups are unchanged. |
| Apply reports the whole pending selection once | covered | `ui/src/components/AgentResourceManager.test.tsx` — “applies the complete resulting selection once…” asserts one callback with the repository id and the complete set. |
| Discard restores the supplied state | covered | `ui/src/components/AgentResourceManager.test.tsx` — “discards pending changes back to the supplied state” asserts the switches and no callback. |
| A pending selection stays with its repository | covered | `ui/src/components/AgentResourceManager.test.tsx` — “keeps a pending selection with its own repository across a switch and back”, plus the tests that keep it across an unrelated inventory and drop it for a vanished repository. |
| The skills that are on can be found | covered | `ui/src/components/AgentResourceManager.test.tsx` — “opens the folder holding a skill that is on in a large collection, and filters to the skills that are on” asserts the skill listed under “Skills that are on” with its folder, the repository list reading “1 on · 60”, that folder open and the others folded, the filter listing that skill alone, and Turn off staging it off. |
| Search narrows a collection's skills | covered | `ui/src/components/AgentResourceManager.test.tsx` — “narrows the skills by search, and a folder's All on then acts on its matches only” asserts the matches, a folder bulk action confined to them, and the empty result. |
| Remove repository requires confirmation | covered | `ui/src/components/AgentResourceManager.test.tsx` — “confirms before removing, names the path, and does nothing on cancel”. |
| Removing an unmanaged repository says the files stay | covered | `ui/src/components/AgentResourceManager.test.tsx` — “says the files stay when pi-outpost does not manage the repository”. |
| A configuration-file repository cannot be removed here | covered | `ui/src/components/AgentResourceManager.test.tsx` — “offers no removal for a configuration-file repository, and says why”. |

## persistent-runtime-settings

| Scenario | Coverage | Assertion evidence |
|---|---|---|
| Restart preserves a collection selection | covered | `server/test/skillCollections.test.ts` — “a persisted selection is what the next load returns” reads the written file back through `loadConfig`; `server/test/skillCollectionsWire.test.mjs` boots a server from such a file and asserts only the enabled skill is loaded. |
| A selection change leaves configuration-file paths intact | covered | `server/test/skillCollections.test.ts` — “writing a collection leaves the configuration file's skill paths as written”. |
| A newly enabled collection skill is visible after apply | covered | `server/test/collectionSelectionWire.test.mjs` — “one skill, all on, one group, all off…” asserts the replacement session reports the newly enabled skill as loaded. |
| A failed write keeps the live selection | covered | `server/test/collectionSelectionWire.test.mjs` — “a selection that cannot be persisted keeps the live one” removes the configuration file, then asserts the refusal, no session replacement, and the live session still loading the old selection. |
| Removal clears the persisted selection | covered | `server/test/collectionRemovalWire.test.mjs` — the managed-removal test asserts `userSkillCollections` is empty on disk afterwards. |
