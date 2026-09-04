## Context

See `proposal.md` for motivation. Runtime resources currently enter through configured and user skill and extension roots. Embedded runtimes can expose skill file paths and source information, while RPC runtimes may expose incomplete provenance and may not expose extension inventory at all. Settings can rebuild resources, but the workspace Git service is intentionally read-only and confined to repositories under the file-browser root.

The update unit is a Git worktree, not an individual resource directory. One worktree may supply several configured roots, both resource kinds, or several workspaces. Updating extensions changes executable code loaded with the agent's privileges. A Git fast-forward succeeds before runtime rebuild begins, so disk mutation and runtime reload cannot honestly be presented as one atomic transaction.

## Goals / Non-Goals

**Goals:**

- Derive update targets exclusively from resource provenance already known to the server.
- Preserve the workspace Git service's read-only boundary.
- Make every eligibility, security, concurrency, and partial-failure state explicit in the protocol and UI.
- Keep started workspaces that share a repository coherent after an update.
- Support embedded and RPC runtimes without fabricating missing provenance.

**Non-Goals:**

- A general Git client or local-change editor.
- Selective file updates within one repository.
- Automatic branch selection, dependency installation, build steps, or arbitrary post-update commands.
- Guaranteed rollback after the repository has advanced.
- Starting dormant workspaces solely to reload their resources.

## Decisions

### 1. Separate local folders from managed Git clones

The Agent resources dialog owns both add flows but keeps their meanings explicit. Add local folder reuses the existing server-directory picker and then asks whether the selected directory is a skill or extension root. It writes the chosen canonical path to the corresponding existing user path list; local folders do not need Git and remain visible in the unmanaged group when no repository encloses them.

Add Git repository accepts a remote address and a local clone folder. The client suggests `<user config dir>/resource-repositories/<slug>-<address-hash>`, exposes that full path, lets the user edit it, and can use the existing directory picker to choose its parent. Supported addresses are parsed as HTTPS, SSH, Git, file URLs, or the conventional `user@host:path` Git form; leading-option, control-character, and shell-framing inputs are rejected. Git receives `--` before the address and is spawned without a shell. Userinfo is removed from browser-visible errors.

The server canonicalizes the destination's existing parent and appends one validated final path segment. It refuses filesystem roots, `.`/`..`, separator-bearing final names, symlink ambiguity, and occupied destinations unless they are already Git worktrees whose canonical `remote.origin.url` matches the address. It never removes or empties a destination. The suggested address hash gives an idempotent default without persisting credentials in a new config field, while the explicit path remains part of the clone request as the user requested.

Clone uses `--no-recurse-submodules` and the same server-owned empty hooks directory as updates. A failed or resource-empty clone registers no runtime path; its managed checkout may remain for diagnosis/retry and is never silently deleted by removing a resource path.

After clone, metadata-only discovery recognizes skill roots containing `SKILL.md` at the repository root, under `skills/`, or under `.agents/skills/`. It recognizes the conventional `extensions/`, `.pi/extensions/`, and `.agents/extensions/` directories when they contain supported extension entry files or package metadata. Discovery reads names and filesystem metadata only; it never imports modules or invokes the runtime loader.

The preview groups candidates by kind and lets the user confirm individual roots. Confirmation translates to the existing `userSkillPaths` and `userExtensionPaths` persistence model, followed by the normal resource rebuild. Duplicate canonical paths are removed. If extensions are locked, extension candidates are disabled but skills can still be selected. The preview carries a fingerprint of repository root, HEAD, and candidate paths; confirmation revalidates it so a replaced directory cannot smuggle different roots into the apply.

The rebuild is also the sandbox-policy handoff. Its replacement runtime factory is created from the new effective sandbox plus every effective skill, prompt, and extension location, so configured roots outside the sandbox remain read-only exceptions for the agent that takes over. A refusal before handoff restores the old settings file, workspace resources, file-browser boundary, and runtime factory together and returns an error; only after the new session takes over may the server acknowledge the settings update. This rollback is possible because no repository has been mutated by enrollment, unlike a post-fast-forward reload failure.

Alternatives considered: selecting a local worktree is not adding a repository address and fails the user's mental model; fixing the destination entirely under managed storage hides where the local checkout lives; recursively treating all source files as extensions would be both noisy and unsafe; keeping the old Settings buttons would preserve two competing resource-management surfaces.

### 2. Model a resource inventory before modeling Git state

Add protocol-level resource descriptors containing a stable resource id, kind, name, origin, optional canonical path, and provenance availability. Repository groups contain opaque server-issued ids, canonical display paths, resource ids, and whether they carry executable extensions. Runtime adapters populate only evidence they actually have. Configured roots can establish a search boundary, but they do not justify inventing individual runtime entries.

For every usable path, the server resolves symlinks and asks Git for the nearest enclosing worktree. It verifies that the resource's canonical path lies within the returned canonical worktree, then deduplicates by canonical worktree. Running discovery independently for each resource naturally attributes paths inside a nested worktree to that nearer repository.

Alternatives considered: deriving repositories only from configured roots misses built-in/runtime-discovered resources; scanning the filesystem or Git parents globally invents resources and enlarges the trust boundary.

### 3. Keep resource Git in a separate service

Introduce a resource-repository service beside, not inside, workspace Git. It may reuse the configured Git executable resolver and hardened process runner, but it has its own command allowlist, identifiers, timeouts, output parsers, and repository registry. Clients send only an opaque repository id and an assessment token; paths and arbitrary revisions are never request inputs.

The service uses fixed argument shapes for repository discovery and assessment, fetches configured upstream state, and integrates only with fast-forward semantics. The integrating Git invocation disables repository hooks using a server-owned empty hooks directory. Each canonical repository has a mutex shared by all clients and workspaces. Immediately before integration the service repeats status, branch, upstream, ancestry, and expected-revision checks while holding that mutex.

Alternatives considered: extending the workspace Git allowlist would mix unrelated repository trust domains; shelling out to `git pull` with client data would make validation and before/after correlation weaker; manipulating refs and the worktree manually would be more destructive than Git's native fast-forward operation.

### 4. Represent assessment as a revision-bound snapshot

Repository state is a discriminated union rather than booleans. An updateable assessment includes repository id, branch, local commit, upstream name, fetched upstream commit, executable-resource flag, and a short-lived opaque token bound to those fields. Update requests echo the token and, for executable repositories, an explicit `allowExecutableChanges` acknowledgement. A refresh replaces older assessments; UI state remains keyed by repository id so late responses cannot move across selections.

Dirty includes index changes, worktree changes, conflicts, and untracked files. Current, detached, ahead, diverged, missing-upstream, locked, busy, unavailable, and failed states each carry a display-safe reason. Remote failure is local to its repository.

Alternatives considered: a single `canUpdate` flag cannot explain remediation; client-only confirmation does not bind consent to the revisions being changed.

### 5. Treat extension-bearing repositories as executable units

If any applicable resource in a repository is an extension, the repository is executable-code-bearing. The UI confirmation is required even if the visible changed files appear skill-only, because a fetched revision changes the repository as a unit. `extensionLock` is enforced again on the server after acquiring the repository mutex. A mixed repository is entirely locked; read-only discovery and refresh remain permitted.

Alternative considered: path-limited checkout would leave the branch/worktree inconsistent with its commit and would not be a repository update.

### 6. Coordinate updates with workspace lifecycle

The server maintains a reverse index from canonical repository id to affected workspaces. Membership comes from both configured/default roots overlapping the worktree and currently loaded resource paths, so additions or removals in a new revision do not escape reload. Before Git mutation, all affected started workspaces must have an idle runtime; processing and replacement phases block the update.

After fast-forward, rebuild resources for every affected started workspace and broadcast each new snapshot/inventory. Rebuilds may run independently after the disk change, but the operation result waits for all of them and reports failures per workspace. Dormant workspaces are recorded as needing no immediate action and load from disk when started.

If Git succeeds and a rebuild fails, retain the advanced clean worktree, keep the failure visible, and offer refresh/retry or workspace restart. Do not use `reset --hard` as compensation: it is a destructive rollback, may race with new local work, and could make already rebuilt runtimes disagree in the opposite direction.

Alternative considered: rebuilding only the requesting workspace leaves other sessions using stale code from the same checkout.

### 7. Use the repository-first dialog from prototype A

Settings gains one Agent resources entry point opening a dialog large enough for a split view. The left pane shows repository and non-updateable pseudo-groups, counts, status badges, search, kind filters, attention filtering, Add local folder, and Add Git repository. The right pane shows branch/upstream state, actions, status explanation, separate skill/extension lists, and removal controls only for user-added roots. Settings retains summaries but delegates path changes to this dialog.

A kind filter derives a presentation view of every repository group rather than merely deciding whether the unfiltered group remains visible. Mixed repositories stay selectable when they contain the requested kind, but their row count and detail lists contain only that kind. This presentation-only subset never narrows update authorization: Git assessment, extension confirmation, and locking still use the server-issued repository metadata for the whole worktree.

Operation state is normalized by repository id and request id. Changing selection never re-labels an in-flight result. Dirty and history states show the canonical repository path and external-terminal guidance, but no mutation affordances. Extension confirmation names the repository and before/after commits.

Alternatives considered: putting the full manager in the narrow Settings menu does not scale to several repositories; resource-first grouping hides that Git updates and locks act on the whole repository.

### 8. Degrade explicitly for runtime capability gaps

Embedded runtime inventory uses SDK provenance where available. RPC adapters preserve standard command source information instead of discarding it, but if an RPC server cannot report paths or extension inventory, the protocol marks those resources or that resource kind unavailable for repository updating. It does not guess from process cwd or silently omit the limitation. An RPC runtime that cannot be rebuilt through the existing lifecycle is reported as reload-unsupported and blocks updates affecting it.

Alternative considered: declaring the feature embedded-only would simplify implementation but make the same UI misleading when the configured runtime changes.

### 9. Spawn git without a way to ask a human anything

Every process this capability starts runs with terminal prompting and askpass helpers
disabled and no interactive terminal inherited from the server. Without that, a private
address turns a refresh into a process sitting on a prompt until the command timeout —
and, when the server was started from a terminal, one that can take that terminal from
the operator. Failing immediately with a readable reason is both safer and more honest
than a request that appears merely slow.

Authentication the deployment has already configured — a credential helper that answers
without prompting, an SSH agent, an unencrypted key — is untouched: this system asks for
no credential of its own, stores none, and strips userinfo from anything it returns.

Alternative considered: collecting credentials in the dialog would make Pi Outpost a
secret store for a capability whose whole point is to lean on the operator's existing git
setup.

### 10. Leave submodules where they are

`merge --ff-only` advances the superproject and leaves submodule working trees on their
old commits, and clone declines to initialize them at all. Advancing them would mean
fetching and checking out further repositories that were never assessed, never confirmed,
and possibly carrying extensions — a second update hidden inside the first. So the
boundary is explicit rather than silent: submodule content is not updated, and a
repository that carries one says so instead of presenting itself as fully current.

### 11. Repository identities live and die with the server

Identities are opaque and issued per server process, so nothing on the wire can be turned
into a filesystem path. The cost is that they do not survive a restart: a client holding
one must treat it as a stale selection rather than an error, fall back to a group that
exists, and re-select. The same rule covers a repository that has genuinely left the
inventory, which is why the UI keys operations by identity and never by list position.

## Risks / Trade-offs

- [Git fetch can invoke configured credential or transport helpers] → Run only after explicit user refresh/update intent, inherit the deployment's existing Git authentication policy, forbid interactive prompting so a missing credential fails instead of hanging, bound execution, and document this operational trust boundary.
- [A repository changes between UI assessment and update] → Bind confirmation to revisions and revalidate under a per-repository mutex immediately before mutation.
- [New revision removes or adds resource paths] → Include configured-root overlap in affected-workspace indexing and rebuild from disk rather than patching the old inventory.
- [Git succeeds but runtime rebuild fails] → Report `updated-reload-failed`, retain exact per-workspace failures, and never imply atomic rollback.
- [RPC provenance differs by runtime version] → Capability-tag inventory fields and expose unavailable states rather than synthesize data.
- [Large installations make refresh slow] → Refresh repositories concurrently with a small bound, deduplicate canonical roots, stream or publish per-repository completion, and keep failures isolated.
- [A repository disappears or stops being a repository underneath the inventory] → Classify it as unavailable with that reason, keep it listed, and never let its resources read as up to date.
- [Managed clones accumulate] → Removing a resource path never deletes a clone, so document where they live and that reclaiming the disk is a deliberate manual act.
- [Repository paths reveal server filesystem layout] → Return paths only for resources already exposed/configured to the connected workspace and avoid including command output that may name unrelated files.

## Migration Plan

1. Add backward-compatible optional protocol fields and resource-operation messages; older clients ignore the inventory additions.
2. Populate provenance in embedded and RPC adapters, leaving unsupported fields explicitly unavailable.
3. Enable repository preview/enrollment plus read-only repository discovery and assessment, then ship the dialog with updates feature-gated off until update and lifecycle tests pass.
4. Enable guarded updates and affected-workspace rebuild orchestration.
5. Update operator documentation and remove the temporary feature gate after running-app and multi-workspace validation.

Rollback disables the update handler and UI affordance while retaining optional inventory fields. Repositories already fast-forwarded are not automatically rewound; operators can manage them with normal external Git tooling.
