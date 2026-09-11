import { useEffect, useMemo, useRef, useState } from "react";
import type {
  AgentResourceInfo,
  AgentResourceInventory,
  AgentResourceKind,
  AgentResourceRepository,
  AgentResourceRepositoryPreview,
} from "@pi-outpost/shared";
import type { AgentResourceOperationState, ServerBrowseState, SettingsApplyState } from "../useAgent";
import { CollectionSkills, groupsOf, sameSelection, suppliedSelection } from "./CollectionSkills";
import { ServerPathPicker } from "./ServerPathPicker";

type Group =
  | { id: string; name: string; path?: string; repository: AgentResourceRepository; resources: AgentResourceInfo[]; count?: number; onCount?: number }
  | { id: string; name: string; reason: string; resources: AgentResourceInfo[]; count?: number; onCount?: number };

type RemovalState = AgentResourceOperationState["removals"][string];

/** What removing a repository did, told in the words of the result rather than inferred. */
function removalMessage(name: string, state: RemovalState): string {
  if (state.status === "loading") return `Removing ${name}…`;
  if (state.status === "error") return state.message ?? `Could not remove ${name}`;
  const result = state.result;
  if (!result) return `Removed ${name}.`;
  if (result.status === "removed") return `Removed ${name} and deleted ${result.path}.`;
  if (result.status === "removed-files-kept") return `Removed ${name}. ${result.reason ?? "Its files were kept"} (${result.path}).`;
  return `Removed ${name}, but not every file could be deleted${result.reason ? ` — ${result.reason}` : ""}. What remains is at ${result.path}.`;
}

interface AgentResourceManagerProps {
  open: boolean;
  inventory: AgentResourceInventory | null;
  operations: AgentResourceOperationState;
  extensionLock: boolean;
  userSkillPaths: string[];
  userExtensionPaths: string[];
  serverBrowse: ServerBrowseState | null;
  applyState: SettingsApplyState | null;
  onClose: () => void;
  onBrowseServerPath: (path: string) => void;
  onCloseServerBrowser: () => void;
  onUpdateConfig: (update: { userSkillPaths?: string[]; userExtensionPaths?: string[] }) => void;
  onSuggestClonePath: (repositoryUrl: string) => void;
  onCloneRepository: (repositoryUrl: string, destinationPath: string) => void;
  onEnrollRepository: (previewToken: string, skillRoots: string[], extensionRoots: string[], enabledSkills?: string[]) => void;
  /** The complete set of a collection's skills that should be on. */
  onSetSkills: (repositoryId: string, enabledSkills: string[]) => void;
  onRemoveRepository: (repositoryId: string) => void;
  onRefresh: (repositoryId?: string) => void;
  onUpdate: (
    repositoryId: string,
    assessmentToken: string,
    localRevision: string,
    upstreamRevision: string,
    allowExecutableChanges?: boolean,
  ) => void;
}

const STATUS_LABEL: Record<AgentResourceRepository["assessment"]["status"], string> = {
  unchecked: "Not checked",
  checking: "Checking…",
  current: "Up to date",
  updateable: "Update available",
  dirty: "Local changes",
  detached: "Detached HEAD",
  ahead: "Local branch ahead",
  diverged: "Histories diverged",
  "no-upstream": "No upstream",
  locked: "Locked",
  busy: "Workspace busy",
  unavailable: "Unavailable",
  failed: "Check failed",
};

function groupInventory(inventory: AgentResourceInventory | null): Group[] {
  if (!inventory) return [];
  const byId = new Map(inventory.resources.map((resource) => [resource.id, resource]));
  const represented = new Set(inventory.repositories.flatMap((repository) => repository.resourceIds));
  const groups: Group[] = inventory.repositories.map((repository) => ({
    id: repository.id,
    name: repository.name,
    path: repository.path,
    repository,
    resources: repository.resourceIds.flatMap((id) => (byId.get(id) ? [byId.get(id)!] : [])),
  }));
  const ungrouped = inventory.resources.filter((resource) => !represented.has(resource.id));
  const unavailable = ungrouped.filter((resource) => resource.unavailableReason);
  const local = ungrouped.filter((resource) => !resource.unavailableReason);
  if (local.length) groups.push({ id: "local", name: "Local and built in", reason: "Not backed by an updateable Git repository", resources: local });
  if (unavailable.length) groups.push({ id: "unavailable", name: "Provenance unavailable", reason: "The active runtime did not report enough filesystem provenance", resources: unavailable });
  return groups;
}

function trimTrailingPathSeparators(value: string): string {
  let end = value.length;
  while (end > 0 && (value[end - 1] === "/" || value[end - 1] === "\\")) end -= 1;
  return end === value.length ? value : value.slice(0, end);
}

function parentPath(value: string): string {
  const normalized = trimTrailingPathSeparators(value);
  const index = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  return index <= 0 ? "/" : normalized.slice(0, index);
}

function joinParent(parent: string, previous: string): string {
  const normalized = trimTrailingPathSeparators(previous);
  const index = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  const name = index >= 0 ? normalized.slice(index + 1) : normalized;
  return `${trimTrailingPathSeparators(parent)}/${name || "agent-resources"}`;
}

function ResourceList({ kind, resources, removalLocked = false, onRemove }: { kind: AgentResourceKind; resources: AgentResourceInfo[]; removalLocked?: boolean; onRemove: (resource: AgentResourceInfo) => void }) {
  return (
    <section className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
      <h3 className="flex items-center justify-between text-sm font-semibold capitalize text-zinc-800 dark:text-zinc-200">
        <span>{kind}s</span><span className="text-xs font-normal text-zinc-400">{resources.length}</span>
      </h3>
      {resources.length === 0 ? <p className="mt-4 text-xs text-zinc-400">None in this group</p> : (
        <ul className="mt-3 space-y-2">
          {resources.map((resource) => (
            <li key={resource.id} className="rounded-lg bg-zinc-50 px-3 py-2 dark:bg-zinc-800/70">
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-sm font-medium text-zinc-700 dark:text-zinc-200">{resource.name}</p>
                {resource.userRoot && !removalLocked ? <button type="button" aria-label={`Remove ${resource.userRoot}`} onClick={() => onRemove(resource)} className="text-xs text-zinc-500 hover:text-red-600">Remove</button> : null}
              </div>
              <p className="mt-0.5 truncate font-mono text-[11px] text-zinc-400" title={resource.path}>{resource.path ?? resource.unavailableReason ?? "Path unavailable"}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PreviewForm({ preview, busy, error, onApply, onCancel }: { preview: AgentResourceRepositoryPreview; busy: boolean; error?: string; onApply: (skills: string[], extensions: string[], enabledSkills?: string[]) => void; onCancel: () => void }) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(preview.roots.filter((root) => !root.locked).map((root) => `${root.kind}:${root.path}`)));
  const [extensionsAcknowledged, setExtensionsAcknowledged] = useState(false);
  // A collection's skills all start off; the preview only records which to turn on.
  const [enabledSkills, setEnabledSkills] = useState<Set<string>>(() => new Set());
  const collection = preview.mode === "collection";
  const catalogue = useMemo(() => preview.skills.map((skill) => ({ ...skill, state: "off" as const })), [preview.skills]);
  const catalogueGroups = useMemo(() => groupsOf(preview.skills, preview.repositoryName), [preview.skills, preview.repositoryName]);
  const selectedExtensions = preview.roots.filter((root) => root.kind === "extension" && selected.has(`extension:${root.path}`));
  const extensionsUnacknowledged = selectedExtensions.length > 0 && !extensionsAcknowledged;
  // A collection may be saved with nothing on: registering its catalogue is the point.
  const saveBlocked = busy || (!collection && selected.size === 0) || extensionsUnacknowledged;
  const save = () => {
    const extensions = selectedExtensions.map((root) => root.path);
    if (collection) onApply([], extensions, [...enabledSkills]);
    else onApply(preview.roots.filter((root) => root.kind === "skill" && selected.has(`skill:${root.path}`)).map((root) => root.path), extensions);
  };
  const toggle = (key: string) => {
    setExtensionsAcknowledged(false);
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };
  return (
    <div className="space-y-3" data-testid="resource-preview">
      {/* The repository is what this screen is about: its name leads, the path follows
          small, and saving sits beside it rather than under a 700-row list. */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="truncate text-xl font-semibold text-zinc-900 dark:text-zinc-100">{preview.repositoryName}</h3>
          <p className="mt-0.5 truncate font-mono text-[11px] text-zinc-500" title={preview.repositoryPath}>{preview.repositoryPath}</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button type="button" onClick={onCancel} className="rounded-md border px-3 py-1.5 text-xs">Cancel</button>
          <button type="button" disabled={saveBlocked} onClick={save} className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900">{busy ? "Saving…" : "Save"}</button>
        </div>
      </div>
      {extensionsUnacknowledged ? <p className="text-xs text-amber-700">Confirm the extension warning below to save.</p> : null}
      {error ? <p role="alert" className="text-xs text-red-600">{error}</p> : null}
      {collection ? <CollectionSkills skills={catalogue} groups={catalogueGroups} enabled={enabledSkills} onChange={setEnabledSkills} disabled={busy} {...(preview.bound ? { bound: preview.bound } : {})} /> : null}
      {preview.roots.map((root) => {
        const key = `${root.kind}:${root.path}`;
        return <label key={key} className={`flex items-start gap-2 rounded border p-2 ${root.locked ? "opacity-50" : "cursor-pointer"}`}>
          <input type="checkbox" checked={selected.has(key)} disabled={root.locked} onChange={() => toggle(key)} />
          <span><span className="block text-sm">{root.name} · {root.kind}</span><span className="font-mono text-[11px] text-zinc-500">{root.path}</span>{root.locked ? <span className="block text-xs text-amber-700">Extension paths are locked</span> : null}</span>
        </label>;
      })}
      {selectedExtensions.length > 0 ? <label className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900"><input type="checkbox" checked={extensionsAcknowledged} onChange={(event) => setExtensionsAcknowledged(event.target.checked)} /><span>Extensions execute code with the agent's privileges. I trust the selected extension roots in this repository.</span></label> : null}

    </div>
  );
}

export function AgentResourceManager(props: AgentResourceManagerProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const closeHandler = useRef(props.onClose);
  const localApplyStarted = useRef(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"all" | AgentResourceKind>("all");
  const [attentionOnly, setAttentionOnly] = useState(false);
  const [addMode, setAddMode] = useState<"local" | "git" | null>(null);
  const [picker, setPicker] = useState<"local" | "clone-parent" | null>(null);
  const [localKind, setLocalKind] = useState<AgentResourceKind>("skill");
  const [localPath, setLocalPath] = useState("");
  const [extensionAcknowledged, setExtensionAcknowledged] = useState(false);
  const [repositoryUrl, setRepositoryUrl] = useState("");
  const [destinationPath, setDestinationPath] = useState("");
  const [destinationEdited, setDestinationEdited] = useState(false);
  /**
   * The address the last suggestion was asked for.
   *
   * A refused address is only news while the field still holds it. Without this,
   * an error raised for a half-typed address stayed under the field, contradicting
   * what the user was in the middle of typing.
   */
  const [suggestedFor, setSuggestedFor] = useState("");
  const [confirmRepository, setConfirmRepository] = useState<AgentResourceRepository | null>(null);
  /**
   * Selections not yet applied, keyed by repository id. Applying replaces the
   * session, so switches only stage here and Apply sends the whole set once.
   */
  const [pendingSkills, setPendingSkills] = useState<Record<string, string[]>>({});
  const [confirmRemoval, setConfirmRemoval] = useState<AgentResourceRepository | null>(null);
  /** The removal whose outcome is on show — kept by id, since the repository leaves the list. */
  const [removalShown, setRemovalShown] = useState<{ id: string; name: string } | null>(null);
  const allGroups = useMemo(() => groupInventory(props.inventory), [props.inventory]);
  const visibleGroups = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return allGroups.flatMap((group): Group[] => {
      // A collection's skills are its catalogue, loaded or not; its loaded skill
      // resources are the same skills again, so they are not counted twice.
      const collection = "repository" in group ? group.repository.collection : undefined;
      const flat = collection ? group.resources.filter((resource) => resource.kind !== "skill") : group.resources;
      const resources = kind === "all" ? flat : flat.filter((resource) => resource.kind === kind);
      const skills = collection && kind !== "extension" ? collection.skills : [];
      const count = resources.length + skills.length;
      // A collection stays reachable with nothing in it, or it could not be removed.
      if (count === 0 && !(collection && kind === "all")) return [];
      if (attentionOnly && (!("repository" in group) || !["updateable", "dirty", "failed", "unavailable", "busy"].includes(group.repository.assessment.status))) return [];
      const searchable = `${group.name} ${"path" in group ? group.path ?? "" : ""} ${resources.map((resource) => `${resource.name} ${resource.path ?? ""}`).join(" ")} ${skills.map((skill) => `${skill.name} ${skill.relativePath}`).join(" ")}`.toLocaleLowerCase();
      const onCount = collection ? collection.skills.filter((skill) => skill.state !== "off").length : undefined;
      return !needle || searchable.includes(needle) ? [{ ...group, resources, count, ...(onCount !== undefined ? { onCount } : {}) }] : [];
    });
  }, [allGroups, attentionOnly, kind, query]);
  const selected = visibleGroups.find((group) => group.id === selectedId) ?? visibleGroups[0] ?? null;

  useEffect(() => { closeHandler.current = props.onClose; }, [props.onClose]);
  /**
   * A new inventory rebases the pending selections rather than dropping them: one
   * is let go only when the repository is gone, or when what the server now
   * reports is exactly what was pending — the apply landed.
   */
  useEffect(() => {
    setPendingSkills((current) => {
      const next: Record<string, string[]> = {};
      let changed = false;
      for (const [id, wanted] of Object.entries(current)) {
        const collection = props.inventory?.repositories.find((candidate) => candidate.id === id)?.collection;
        if (!collection || sameSelection(wanted, suppliedSelection(collection))) changed = true;
        else next[id] = wanted;
      }
      return changed ? next : current;
    });
  }, [props.inventory]);
  /**
   * Focus enters the dialog when it opens, and never again.
   *
   * This used to depend on `props.onClose` as well, which the parent recreates on
   * every one of its renders — so every inventory push, every assessment tick,
   * re-ran the effect and pulled the focus back onto the close button. Anyone
   * typing into the dialog lost the caret mid-word, and the address field's blur
   * then validated a half-typed address and called it invalid.
   */
  useEffect(() => {
    if (!props.open) return;
    closeRef.current?.focus();
  }, [props.open]);
  useEffect(() => {
    if (!props.open) return;
    // Through the ref, so a new `onClose` identity does not re-register this and
    // does not drag the focus effect along with it.
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") closeHandler.current(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [props.open]);
  useEffect(() => {
    const result = props.operations.clonePath;
    if (result?.status === "ready" && result.path && !destinationEdited) setDestinationPath(result.path);
  }, [destinationEdited, props.operations.clonePath]);
  useEffect(() => {
    if (props.operations.enrollment?.status === "ready") setAddMode(null);
  }, [props.operations.enrollment]);
  useEffect(() => {
    if (props.applyState?.status === "applying") {
      localApplyStarted.current = true;
      return;
    }
    if (localApplyStarted.current && props.applyState === null) {
      localApplyStarted.current = false;
      setAddMode(null);
      setPicker(null);
      setExtensionAcknowledged(false);
    }
  }, [props.applyState]);

  if (!props.open) return null;
  const repository = selected && "repository" in selected ? selected.repository : null;
  const updateState = repository ? props.operations.updates[repository.id] : undefined;
  const assessment = repository?.assessment;
  const updateable = assessment?.status === "updateable" && assessment.token && assessment.localRevision && assessment.upstreamRevision;
  const applyLocal = () => {
    const canonicalCandidate = localPath.trim();
    if (!canonicalCandidate) return;
    if (localKind === "skill") props.onUpdateConfig({ userSkillPaths: [...new Set([...props.userSkillPaths, canonicalCandidate])] });
    else props.onUpdateConfig({ userExtensionPaths: [...new Set([...props.userExtensionPaths, canonicalCandidate])] });
  };
  const removeResource = (resource: AgentResourceInfo) => {
    if (!resource.userRoot) return;
    if (resource.kind === "skill") props.onUpdateConfig({ userSkillPaths: props.userSkillPaths.filter((entry) => entry !== resource.userRoot) });
    else props.onUpdateConfig({ userExtensionPaths: props.userExtensionPaths.filter((entry) => entry !== resource.userRoot) });
  };
  const requestUpdate = (target: AgentResourceRepository, allowExecutableChanges = false) => {
    const value = target.assessment;
    if (!value.token || !value.localRevision || !value.upstreamRevision) return;
    props.onUpdate(target.id, value.token, value.localRevision, value.upstreamRevision, allowExecutableChanges);
  };
  const collection = repository?.collection;
  const suppliedSkills = collection ? suppliedSelection(collection) : [];
  const effectiveSkills = new Set(repository && pendingSkills[repository.id] ? pendingSkills[repository.id] : suppliedSkills);
  const pendingChanges = collection
    ? [...new Set([...effectiveSkills, ...suppliedSkills])].filter((relative) => effectiveSkills.has(relative) !== suppliedSkills.includes(relative)).length
    : 0;
  // Read defensively: a caller holding an older operations shape must not unmount the dialog.
  const skillsState = repository ? props.operations.skills?.[repository.id] : undefined;
  const changeSkills = (next: Set<string>) => {
    if (!repository) return;
    const id = repository.id;
    setPendingSkills((current) => {
      const copy = { ...current };
      if (sameSelection(next, suppliedSkills)) delete copy[id];
      else copy[id] = [...next];
      return copy;
    });
  };
  const discardSkills = () => {
    if (!repository) return;
    const id = repository.id;
    setPendingSkills((current) => {
      const copy = { ...current };
      delete copy[id];
      return copy;
    });
  };
  const applySkills = () => {
    if (!repository || !collection) return;
    // A skill the repository no longer has cannot be turned on; applying lets it go.
    const present = new Set(collection.skills.filter((skill) => skill.state !== "on-missing").map((skill) => skill.relativePath));
    props.onSetSkills(repository.id, [...effectiveSkills].filter((relative) => present.has(relative)));
  };
  const removalState = removalShown ? props.operations.removals?.[removalShown.id] : undefined;
  const removalFailed = removalState?.status === "error" || removalState?.result?.status === "removed-delete-failed";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) props.onClose(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="agent-resources-title" className="flex h-[min(760px,92vh)] w-[min(1120px,96vw)] flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900">
        <header className="flex items-center justify-between border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <div><h2 id="agent-resources-title" className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Agent resources</h2><p className="text-xs text-zinc-500">Skills and extensions, grouped by repository</p></div>
          <div className="flex gap-2"><button type="button" disabled={props.operations.refresh?.status === "loading"} onClick={() => props.onRefresh()} className="rounded-md border px-3 py-1.5 text-xs disabled:opacity-50">Refresh all</button><button ref={closeRef} type="button" aria-label="Close agent resources" onClick={props.onClose} className="rounded-md border px-2 py-1 text-sm">✕</button></div>
        </header>
        <div className="grid min-h-0 flex-1 grid-cols-[300px_1fr]">
          <aside className="flex min-h-0 flex-col border-r border-zinc-200 bg-zinc-50/80 p-3 dark:border-zinc-800 dark:bg-zinc-950/40">
            <input aria-label="Search resources" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search repositories or resources" className="rounded-md border bg-white px-3 py-2 text-xs dark:bg-zinc-900" />
            <div className="mt-2 flex flex-wrap gap-1">
              {(["all", "skill", "extension"] as const).map((value) => <button type="button" key={value} aria-pressed={kind === value} onClick={() => setKind(value)} className={`rounded px-2 py-1 text-[11px] ${kind === value ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "border"}`}>{value === "all" ? "All" : `${value}s`}</button>)}
              <button type="button" aria-pressed={attentionOnly} onClick={() => setAttentionOnly((value) => !value)} className={`rounded px-2 py-1 text-[11px] ${attentionOnly ? "bg-amber-600 text-white" : "border"}`}>Needs attention</button>
            </div>
            <div className="mt-3 min-h-0 flex-1 space-y-1 overflow-y-auto">
              {visibleGroups.map((group) => <button type="button" key={group.id} onClick={() => setSelectedId(group.id)} className={`w-full rounded-lg px-3 py-2.5 text-left ${selected?.id === group.id ? "bg-white shadow-sm ring-1 ring-zinc-200 dark:bg-zinc-800 dark:ring-zinc-700" : "hover:bg-white/70 dark:hover:bg-zinc-900"}`}>
                <span className="flex items-center justify-between gap-2 text-sm font-medium"><span className="truncate">{group.name}</span><span className="shrink-0 text-xs text-zinc-400">{group.onCount !== undefined ? `${group.onCount} on · ${group.count}` : group.count ?? group.resources.length}</span></span>
                <span className="mt-1 block text-xs text-zinc-500">{"repository" in group ? STATUS_LABEL[group.repository.assessment.status] : group.reason}</span>
              </button>)}
              {visibleGroups.length === 0 ? <p className="px-2 py-4 text-xs text-zinc-500">No matching resources</p> : null}
            </div>
            <div className="mt-3 grid gap-2 border-t pt-3"><button type="button" onClick={() => { setExtensionAcknowledged(false); setAddMode("local"); setPicker("local"); props.onBrowseServerPath(localPath || "/"); }} className="rounded-md border bg-white px-3 py-2 text-xs font-medium dark:bg-zinc-900">Add local folder…</button><button type="button" onClick={() => setAddMode("git")} className="rounded-md bg-zinc-900 px-3 py-2 text-xs font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">Add Git repository…</button></div>
          </aside>
          <main className="min-w-0 overflow-y-auto p-6">
            {removalShown && removalState ? (
              <div role={removalFailed ? "alert" : "status"} className={`mb-4 flex items-start justify-between gap-3 rounded-lg border p-3 text-sm ${removalFailed ? "border-rose-200 bg-rose-50 text-rose-800" : "border-zinc-200 bg-zinc-50 text-zinc-700"}`}>
                <p className="min-w-0 break-words">{removalMessage(removalShown.name, removalState)}</p>
                {removalState.status !== "loading" ? <button type="button" onClick={() => setRemovalShown(null)} className="shrink-0 text-xs underline">Dismiss</button> : null}
              </div>
            ) : null}
            {addMode === "local" ? <div className="max-w-xl space-y-4" data-testid="add-local-folder">
              <div><h3 className="text-lg font-semibold">Add local folder</h3><p className="text-xs text-zinc-500">Choose an existing folder on the server and how the agent should load it.</p></div>
              <div className="flex gap-2">{(["skill", "extension"] as const).map((value) => <button type="button" key={value} aria-pressed={localKind === value} disabled={value === "extension" && props.extensionLock} onClick={() => { setLocalKind(value); setExtensionAcknowledged(false); }} className={`rounded-md px-3 py-1.5 text-xs ${localKind === value ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "border"}`}>{value === "skill" ? "Skill folder" : "Extension folder"}</button>)}</div>
              <div className="flex gap-2"><input aria-label="Local resource folder" value={localPath} onChange={(event) => { setExtensionAcknowledged(false); setLocalPath(event.target.value); }} className="min-w-0 flex-1 rounded-md border bg-transparent px-3 py-2 text-sm" /><button type="button" onClick={() => { setPicker("local"); props.onBrowseServerPath(localPath || "/"); }} className="rounded-md border px-3 text-xs">Browse…</button></div>
              {picker === "local" ? <ServerPathPicker label="Choose a local resource folder" browse={props.serverBrowse} onBrowse={props.onBrowseServerPath} onSelect={(value) => { setExtensionAcknowledged(false); setLocalPath(value); setPicker(null); props.onCloseServerBrowser(); }} onCancel={() => { setPicker(null); props.onCloseServerBrowser(); }} /> : null}
              {localKind === "extension" ? <label className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900"><input type="checkbox" checked={extensionAcknowledged} onChange={(event) => setExtensionAcknowledged(event.target.checked)} /><span>Extensions execute code with the agent's privileges. I trust every extension in this folder.</span></label> : null}
              {props.extensionLock ? <p className="text-xs text-zinc-500">Extension paths are locked by this deployment.</p> : null}
              {props.applyState?.status === "error" ? <p role="alert" className="text-xs text-red-600">{props.applyState.message}</p> : null}
              <div className="flex gap-2"><button type="button" onClick={() => { setExtensionAcknowledged(false); setAddMode(null); setPicker(null); props.onCloseServerBrowser(); }} className="rounded-md border px-3 py-1.5 text-xs">Cancel</button><button type="button" disabled={!localPath.trim() || props.applyState?.status === "applying" || (localKind === "extension" && (!extensionAcknowledged || props.extensionLock))} onClick={applyLocal} className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs text-white disabled:opacity-50">{props.applyState?.status === "applying" ? "Applying…" : "Add folder"}</button></div>
            </div> : addMode === "git" ? <div className="max-w-2xl space-y-4" data-testid="add-git-repository">
              {props.operations.preview?.status === "ready" && props.operations.preview.preview ? <PreviewForm onCancel={() => { setAddMode(null); setPicker(null); props.onCloseServerBrowser(); }} preview={props.operations.preview.preview} busy={props.operations.enrollment?.status === "loading"} error={props.operations.enrollment?.status === "error" ? props.operations.enrollment.message : undefined} onApply={(skills, extensions, enabledSkills) => enabledSkills
                ? props.onEnrollRepository(props.operations.preview!.preview!.token, skills, extensions, enabledSkills)
                : props.onEnrollRepository(props.operations.preview!.preview!.token, skills, extensions)} /> : <>
                <div><h3 className="text-lg font-semibold">Add Git repository</h3><p className="text-xs text-zinc-500">Clone it to a local folder, then choose what to turn on.</p></div>
                <label className="block"><span className="text-xs font-medium">Repository address</span><input aria-label="Repository address" value={repositoryUrl} onChange={(event) => setRepositoryUrl(event.target.value)} onBlur={() => { const address = repositoryUrl.trim(); if (address) { setDestinationEdited(false); setSuggestedFor(address); props.onSuggestClonePath(repositoryUrl); } }} placeholder="https://github.com/team/resources.git" className="mt-1 w-full rounded-md border bg-transparent px-3 py-2 text-sm" /></label>
                <label className="block"><span className="text-xs font-medium">Local folder</span><div className="mt-1 flex gap-2"><input aria-label="Local clone folder" value={destinationPath} onChange={(event) => { setDestinationEdited(true); setDestinationPath(event.target.value); }} placeholder="/path/to/resource-repositories/team-resources-ab12cd" className="min-w-0 flex-1 rounded-md border bg-transparent px-3 py-2 text-sm" /><button type="button" onClick={() => { setPicker("clone-parent"); props.onBrowseServerPath(parentPath(destinationPath)); }} className="rounded-md border px-3 text-xs">Choose parent…</button></div></label>
                {props.operations.clonePath?.status === "loading" ? <p className="text-xs text-zinc-500">Suggesting a managed folder…</p> : null}
                {props.operations.clonePath?.status === "error" && repositoryUrl.trim() === suggestedFor ? <p role="alert" className="text-xs text-red-600">{props.operations.clonePath.message}</p> : null}
                {picker === "clone-parent" ? <ServerPathPicker label="Choose the clone's parent folder" browse={props.serverBrowse} onBrowse={props.onBrowseServerPath} onSelect={(value) => { setDestinationPath(joinParent(value, destinationPath)); setPicker(null); props.onCloseServerBrowser(); }} onCancel={() => { setPicker(null); props.onCloseServerBrowser(); }} /> : null}
                {props.operations.preview?.status === "error" ? <p role="alert" className="text-xs text-red-600">{props.operations.preview.message}</p> : null}
                <div className="flex gap-2"><button type="button" onClick={() => { setAddMode(null); setPicker(null); props.onCloseServerBrowser(); }} className="rounded-md border px-3 py-1.5 text-xs">Cancel</button><button type="button" disabled={!repositoryUrl.trim() || !destinationPath.trim() || props.operations.preview?.status === "loading"} onClick={() => props.onCloneRepository(repositoryUrl, destinationPath)} className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs text-white disabled:opacity-50">{props.operations.preview?.status === "loading" ? "Cloning…" : "Clone and inspect"}</button></div>
              </>}
            </div> : selected ? <>
              <div className="flex items-start justify-between gap-4"><div className="min-w-0"><div className="flex items-center gap-2"><h3 className="text-xl font-semibold">{selected.name}</h3>{repository ? <span className="rounded-full border px-2 py-0.5 text-[11px]">{STATUS_LABEL[repository.assessment.status]}</span> : null}</div><p className="mt-1 truncate font-mono text-xs text-zinc-500">{"repository" in selected ? selected.path : selected.reason}</p>{assessment?.branch ? <p className="mt-1 text-xs text-zinc-400">{assessment.branch}{assessment.upstream ? ` → ${assessment.upstream}` : ""}</p> : null}{repository?.removal && !repository.removal.allowed ? <p className="mt-1 text-xs text-zinc-500">{repository.removal.reason}</p> : null}</div>{repository ? <div className="flex gap-2">{repository.removal?.allowed ? <button type="button" disabled={props.operations.removals?.[repository.id]?.status === "loading"} onClick={() => setConfirmRemoval(repository)} className="rounded-md border border-red-200 px-3 py-1.5 text-xs text-red-700 disabled:opacity-50 dark:border-red-900 dark:text-red-400">Remove repository</button> : null}<button type="button" disabled={props.operations.refresh?.status === "loading"} onClick={() => props.onRefresh(repository.id)} className="rounded-md border px-3 py-1.5 text-xs">Check</button>{/* Offered only when there is something to apply: a greyed button that does nothing on click explained nothing. */}{updateable || updateState?.status === "loading" ? <button type="button" disabled={updateState?.status === "loading"} onClick={() => repository.containsExtensions ? setConfirmRepository(repository) : requestUpdate(repository)} className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs text-white disabled:opacity-50">{updateState?.status === "loading" ? "Updating…" : "Update repository"}</button> : null}</div> : null}</div>
              {assessment?.reason ? <div className={`mt-5 rounded-lg border p-3 text-sm ${assessment.status === "dirty" ? "border-rose-200 bg-rose-50 text-rose-800" : "border-zinc-200 bg-zinc-50 text-zinc-700"}`}>{assessment.reason}{assessment.status === "dirty" ? <p className="mt-1 text-xs">Review and resolve these local changes in an external terminal, then check again. This updater never commits, stashes, discards, rebases, or merges them.</p> : null}</div> : null}
              {assessment?.hasSubmodules ? <p className="mt-3 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">This repository declares submodules. Their working trees will not be initialized or updated.</p> : null}
              {updateState?.status === "ready" ? <p role="status" className="mt-3 text-xs text-zinc-600">{updateState.result?.status === "updated" ? "Repository updated and runtimes reloaded." : updateState.result?.status === "updated-reload-failed" ? "Repository updated on disk, but at least one runtime failed to reload." : updateState.result?.reason}</p> : null}
              {updateState?.status === "error" ? <p role="alert" className="mt-3 text-xs text-red-600">{updateState.message}</p> : null}
              {collection && repository && kind !== "extension" ? <div className="mt-6 space-y-4">
                {pendingChanges > 0 || skillsState?.status === "loading" ? (
                  <div className="flex items-center justify-between gap-3 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-200">
                    <span>{skillsState?.status === "loading" ? "Applying…" : `${pendingChanges} pending change${pendingChanges === 1 ? "" : "s"} — applying replaces the session`}</span>
                    <div className="flex gap-2">
                      <button type="button" disabled={skillsState?.status === "loading"} onClick={discardSkills} className="rounded border bg-white px-2.5 py-1 disabled:opacity-50 dark:bg-zinc-900">Discard</button>
                      <button type="button" disabled={skillsState?.status === "loading" || pendingChanges === 0} onClick={applySkills} className="rounded bg-zinc-900 px-2.5 py-1 font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900">Apply</button>
                    </div>
                  </div>
                ) : null}
                {skillsState?.status === "error" ? <p role="alert" className="text-xs text-red-600">{skillsState.message}</p> : null}
                <CollectionSkills key={repository.id} skills={collection.skills} groups={collection.groups} enabled={effectiveSkills} onChange={changeSkills} disabled={skillsState?.status === "loading"} {...(collection.bound ? { bound: collection.bound } : {})} />
                {selected.resources.some((resource) => resource.kind === "extension") ? <ResourceList kind="extension" resources={selected.resources.filter((resource) => resource.kind === "extension")} removalLocked={props.extensionLock} onRemove={removeResource} /> : null}
              </div> : <div className="mt-6 grid grid-cols-2 gap-4"><ResourceList kind="skill" resources={selected.resources.filter((resource) => resource.kind === "skill")} onRemove={removeResource} /><ResourceList kind="extension" resources={selected.resources.filter((resource) => resource.kind === "extension")} removalLocked={props.extensionLock} onRemove={removeResource} /></div>}
            </> : <p className="text-sm text-zinc-500">No resources are reported by this runtime.</p>}
          </main>
        </div>
      </div>
      {confirmRepository ? <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/55 p-4"><div role="alertdialog" aria-modal="true" aria-labelledby="extension-update-title" className="w-full max-w-md rounded-xl bg-white p-5 shadow-2xl dark:bg-zinc-900"><h3 id="extension-update-title" className="font-semibold">Update executable extensions?</h3><p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">{confirmRepository.name} contains extensions that run with the agent's privileges. Confirm updating {confirmRepository.assessment.localRevision?.slice(0, 8)} to {confirmRepository.assessment.upstreamRevision?.slice(0, 8)}.</p><div className="mt-4 flex justify-end gap-2"><button type="button" onClick={() => setConfirmRepository(null)} className="rounded border px-3 py-1.5 text-xs">Cancel</button><button type="button" onClick={() => { requestUpdate(confirmRepository, true); setConfirmRepository(null); }} className="rounded bg-amber-600 px-3 py-1.5 text-xs font-medium text-white">Confirm executable update</button></div></div></div> : null}
      {confirmRemoval ? <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/55 p-4">
        <div role="alertdialog" aria-modal="true" aria-labelledby="remove-repository-title" aria-describedby="remove-repository-detail" className="w-full max-w-md rounded-xl bg-white p-5 shadow-2xl dark:bg-zinc-900">
          <h3 id="remove-repository-title" className="font-semibold">Remove {confirmRemoval.name}?</h3>
          <p id="remove-repository-detail" className="mt-2 break-words text-sm text-zinc-600 dark:text-zinc-300">
            {confirmRemoval.removal?.deletesFiles
              ? <>This stops loading everything from {confirmRemoval.name} and deletes <span className="font-mono">{confirmRemoval.removal.path}</span> from disk, with any local changes in it. This cannot be undone.</>
              : <>This stops loading everything from {confirmRemoval.name}. pi-outpost does not manage <span className="font-mono">{confirmRemoval.removal?.path ?? confirmRemoval.path}</span>, so its files will be kept.</>}
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={() => setConfirmRemoval(null)} className="rounded border px-3 py-1.5 text-xs">Cancel</button>
            <button type="button" onClick={() => { props.onRemoveRepository(confirmRemoval.id); setRemovalShown({ id: confirmRemoval.id, name: confirmRemoval.name }); setConfirmRemoval(null); }} className="rounded bg-red-600 px-3 py-1.5 text-xs font-medium text-white">{confirmRemoval.removal?.deletesFiles ? "Delete and remove" : "Remove repository"}</button>
          </div>
        </div>
      </div> : null}
    </div>
  );
}
