import { useEffect, useRef, useState } from "react";
import { useClickOutside } from "../util/clickOutside";
import { ServerPathPicker } from "./ServerPathPicker";
import { AgentResourceManager } from "./AgentResourceManager";
import type { AgentResourceOperationState, ServerBrowseState, SettingsApplyState } from "../useAgent";
import type { AgentResourceInventory, GitUnavailable } from "@pi-outpost/shared";

interface SandboxConfig {
  root: string;
  allowWrite: boolean;
  allowBash: boolean;
  writableRoot?: string;
  locks?: { root?: boolean; allowWrite?: boolean; allowBash?: boolean; writableRoot?: boolean };
}

/**
 * A copy in a stable order.
 *
 * The server sorts what it sends today, but the menu is what the reader looks at:
 * a list that reorders between two openings because a runtime changed its mind is
 * a list nobody can scan. Sorting here makes that independent of the wire.
 */
function sorted(values: string[]): string[] {
  return [...values].sort((a, b) => a.localeCompare(b));
}

/** Which path field the directory picker is currently open for. */
type PickerField = "root" | "writableRoot";

interface SettingsMenuProps {
  /**
   * Extension files the runtime reported loading, or null when it cannot report an
   * inventory. Null is not the empty list — see the extensions section below.
   */
  extensionPaths: string[] | null;
  /**
   * Extension paths from the configuration file. Shown so an operator can see what
   * is loaded and why, never editable here: they are the deployment's.
   */
  configuredExtensionPaths: string[];
  /** Extension paths added through Settings — the editable list. */
  userExtensionPaths: string[];
  /** When true the deployment forbids editing them, and no control is drawn. */
  extensionLock: boolean;
  tools: { name: string; active: boolean }[];
  commands: { name: string; source: string }[];
  sandbox: SandboxConfig | null;
  /**
   * Why git is unavailable, or null when it is available.
   *
   * Shown here because this is where a user goes when a feature is missing, and
   * because the alternative — hiding every git affordance and saying nothing — makes
   * an unrunnable executable indistinguishable from a directory that was never a
   * repository. One of those is a five-second fix; the other is not a fault at all.
   */
  gitUnavailable: GitUnavailable | null;
  /**
   * Skill paths added through Settings — the only ones this menu shows. The
   * configuration file's own `skillPaths` are the deployment's business: they
   * load either way, their skills appear in the inventory above, and they are
   * neither listed nor removable here.
   */
  userSkillPaths: string[];
  /** The open server-directory listing, or null when no picker is open. */
  serverBrowse: ServerBrowseState | null;
  /** Another picker in the header opened: close this one rather than stack it. */
  pickerBlocked?: boolean;
  /** Opening this picker, so whoever coordinates the header can close the others. */
  onPickerOpened?: () => void;
  /** In-flight apply, so the menu can stay open and say why one was refused. */
  applyState: SettingsApplyState | null;
  agentResources?: AgentResourceInventory | null;
  agentResourceOperations?: AgentResourceOperationState;
  versions?: { piOutpost: string; piSdk?: string; agent?: string } | null;
  onBrowseServerPath: (path: string) => void;
  onCloseServerBrowser: () => void;
  onUpdateConfig: (update: {
    sandbox?: SandboxConfig;
    userSkillPaths?: string[];
    userExtensionPaths?: string[];
  }) => void;
  onSuggestAgentResourceClonePath?: (repositoryUrl: string) => void;
  onCloneAgentResourceRepository?: (repositoryUrl: string, destinationPath: string) => void;
  onEnrollAgentResourceRepository?: (previewToken: string, skillRoots: string[], extensionRoots: string[]) => void;
  onRefreshAgentResourceRepositories?: (repositoryId?: string) => void;
  onUpdateAgentResourceRepository?: (
    repositoryId: string,
    assessmentToken: string,
    localRevision: string,
    upstreamRevision: string,
    allowExecutableChanges?: boolean,
  ) => void;
}

export function SettingsMenu({
  extensionPaths,
  configuredExtensionPaths,
  userExtensionPaths,
  extensionLock,
  tools,
  commands,
  sandbox,
  gitUnavailable,
  userSkillPaths,
  serverBrowse,
  pickerBlocked = false,
  onPickerOpened,
  applyState,
  agentResources = null,
  agentResourceOperations = { clonePath: null, preview: null, enrollment: null, refresh: null, updates: {} },
  versions,
  onBrowseServerPath,
  onCloseServerBrowser,
  onUpdateConfig,
  onSuggestAgentResourceClonePath = () => {},
  onCloneAgentResourceRepository = () => {},
  onEnrollAgentResourceRepository = () => {},
  onRefreshAgentResourceRepositories = () => {},
  onUpdateAgentResourceRepository = () => {},
}: SettingsMenuProps) {
  const [open, setOpen] = useState(false);
  const [resourcesOpen, setResourcesOpen] = useState(false);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const [sandboxRoot, setSandboxRoot] = useState("");
  const [sandboxWritableRoot, setSandboxWritableRoot] = useState("");
  const [sandboxAllowWrite, setSandboxAllowWrite] = useState(false);
  const [sandboxAllowBash, setSandboxAllowBash] = useState(false);
  const [picking, setPicking] = useState<PickerField | null>(null);

  useEffect(() => {
    // Yield to whichever picker opened after this one: two open at once would
    // compete for the single server-browse listing behind them.
    //
    // This picker only. The control that just opened has already asked for its
    // own listing, and releasing the shared one here would discard the request it
    // is waiting on — leaving the new picker up with nothing in it.
    if (pickerBlocked && picking !== null) setPicking(null);
  }, [pickerBlocked, picking]);
  // Only when this menu is actually open. The handler runs on every mousedown
  // anywhere else in the app, and `close()` releases the shared server-browse
  // listing — so an unconditional call took the listing out from under whichever
  // other control was walking it, on the first click inside that control.
  const ref = useClickOutside(() => {
    if (open || picking !== null) close();
  });
  const activeTools = tools.filter((tool) => tool.active);
  const inactiveTools = tools.filter((tool) => !tool.active);
  const skills = commands.filter((command) => command.source === "skill");
  const sortedTools = [...tools].sort(
    (a, b) => a.name.localeCompare(b.name) || Number(b.active) - Number(a.active),
  );
  const applying = applyState?.status === "applying";
  const applyError = applyState?.status === "error" ? applyState.message : null;

  // Sync local state when sandbox config changes (e.g. after apply ack)
  useEffect(() => {
    if (sandbox) {
      setSandboxRoot(sandbox.root);
      setSandboxWritableRoot(sandbox.writableRoot ?? "");
      setSandboxAllowWrite(sandbox.allowWrite);
      setSandboxAllowBash(sandbox.allowBash);
    }
  }, [sandbox]);

  // Same for the skill paths this menu owns: the server's list is the truth, and a
  // refused apply leaves it exactly as it was — which is what the draft resets to.
  // Close on a *successful* apply only. A refusal keeps the menu up with the
  // server's reason on it — the previous version closed on send, so the one
  // message explaining why nothing happened landed behind a closed menu.
  const wasApplying = useRef(false);
  useEffect(() => {
    if (wasApplying.current && applyState === null) close();
    wasApplying.current = applying;
  }, [applyState, applying]);

  function close() {
    setOpen(false);
    setPicking(null);
    onCloseServerBrowser();
  }

  /** Open the picker for one field, starting from whatever that field points at. */
  function startPicking(field: PickerField, from: string) {
    onPickerOpened?.();
    setPicking(field);
    onBrowseServerPath(from.trim() || "/");
  }

  function handlePicked(path: string) {
    if (picking === "root") setSandboxRoot(path);
    else if (picking === "writableRoot") setSandboxWritableRoot(path);
    setPicking(null);
    onCloseServerBrowser();
  }

  function handleApply() {
    // Always send all sandbox fields; the server enforces locks, so skipping locked
    // fields here would fail server-side validation (typeof check on missing bools).
    const payload: SandboxConfig | undefined = sandbox
      ? {
          root: sandboxRoot,
          allowWrite: sandboxAllowWrite,
          allowBash: sandboxAllowBash,
          writableRoot: sandboxWritableRoot.trim() || undefined,
        }
      : undefined;
    onUpdateConfig({
      ...(payload ? { sandbox: payload } : {}),
    });
  }

  /*
   * Blocked is answered here, in the render, and not only by the effect below.
   *
   * An effect runs *after* the render that scheduled it, so a picker being closed
   * because another one opened is still on the page for one frame — two pickers,
   * two "Go" buttons, two of everything a test or a reader can address. The effect
   * still runs, because the state has to converge: without it this picker would
   * reappear the moment the other one closed and `pickerBlocked` went false again.
   * What changes is that the overlap is no longer observable.
   */
  const picker = picking !== null && !pickerBlocked && (
    <ServerPathPicker
      label={picking === "root" ? "Choose the sandbox root" : "Choose the writable root"}
      browse={serverBrowse}
      onBrowse={onBrowseServerPath}
      onSelect={handlePicked}
      onCancel={() => {
        setPicking(null);
        onCloseServerBrowser();
      }}
    />
  );

  return (
    <div className="relative" ref={ref}>
      <button
        ref={settingsButtonRef}
        type="button"
        onClick={() => setOpen(!open)}
        title="Settings"
        aria-label="Settings"
        className="rounded-md border border-zinc-300 px-2 py-1 text-xs text-zinc-500 hover:border-zinc-400 hover:text-zinc-700 dark:border-zinc-800 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:text-zinc-200"
      >
        ⚙
      </button>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-1 flex max-h-[80vh] w-[380px] flex-col rounded-lg border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
          <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
            <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">Settings</h2>
          </div>

          <div className="min-h-0 overflow-y-auto p-4">
            {/* Truthy, not `!== null`: a prop that never arrives must not take the whole
                panel down with it — every other section here is unrelated to git. */}
            {gitUnavailable && (
              <section className="mb-4" data-testid="git-unavailable">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Version control</h3>
                {gitUnavailable.reason === "no-repository" ? (
                  // The ordinary state of a directory. Stated, not raised: there is
                  // nothing here for the user to fix, and dressing it as a fault would
                  // send them looking for one.
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">This project is not in a git repository.</p>
                ) : (
                  <div className="rounded border border-amber-300 bg-amber-50 px-2 py-1.5 dark:border-amber-900 dark:bg-amber-950/40">
                    <p className="text-xs text-amber-800 dark:text-amber-300">
                      {gitUnavailable.reason === "no-executable"
                        ? "Git is unavailable: its executable could not be run."
                        : "Git is unavailable: it refused this repository."}
                    </p>
                    <p className="mt-1 break-all font-mono text-[11px] text-amber-700 dark:text-amber-400">{gitUnavailable.message}</p>
                    {gitUnavailable.reason === "no-executable" && (
                      <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                        Install git, add it to PATH, or name it with <span className="font-mono">gitPath</span> in the configuration.
                      </p>
                    )}
                  </div>
                )}
              </section>
            )}
            <section className="mb-4">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Agent resources</h3>
              {tools.length === 0 ? <p className="text-xs text-zinc-400 dark:text-zinc-500">Tool inventory unavailable for this runtime</p> : <details data-testid="tools-loaded">
                <summary className="cursor-pointer text-xs text-zinc-600 dark:text-zinc-400">{activeTools.length} tools active{inactiveTools.length ? ` · ${inactiveTools.length} inactive` : ""}</summary>
                <ul className="mt-2 space-y-1">
                  {sortedTools.map((tool) => <li key={tool.name} className="flex justify-between rounded bg-zinc-50 px-2 py-1 font-mono text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"><span>{tool.name}</span><span>{tool.active ? "active" : "inactive"}</span></li>)}
                </ul>
              </details>}
              {skills.length === 0 ? <p className="mt-2 text-xs text-zinc-400 dark:text-zinc-500">No skills loaded</p> : <details className="mt-2" data-testid="skills-loaded">
                <summary className="cursor-pointer text-xs text-zinc-600 dark:text-zinc-400">{skills.length} skills loaded</summary>
                {/* Inventory, not settings: this lists what the session actually has,
                    built-in skills included, and offers no way to remove any of them.
                    What can be added and removed is the path list below. */}
                <ul className="mt-2 space-y-1">{sorted(skills.map((skill) => skill.name)).map((name) => <li key={name} className="rounded bg-zinc-50 px-2 py-1 font-mono text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">{name}</li>)}</ul>
              </details>}

              <button
                type="button"
                aria-label="Manage agent resources"
                onClick={() => {
                  setOpen(false);
                  setResourcesOpen(true);
                }}
                className="mt-3 w-full rounded-md border border-zinc-300 px-3 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                Manage resources…
              </button>
            </section>
            {/* Extensions section */}
            <section className="mb-4">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                Extensions
              </h3>
              {/* Three states, not two. `null` is a runtime that cannot report an
                  inventory — an RPC child loads its own — and saying "none" there
                  states a fact this server was never given. */}
              {extensionPaths === null ? (
                <p className="text-xs text-zinc-400 dark:text-zinc-500" data-testid="extensions-unknown">
                  Not reported by this runtime
                </p>
              ) : extensionPaths.length === 0 ? (
                <p className="text-xs text-zinc-400 dark:text-zinc-500">No extensions loaded</p>
              ) : (
                <details data-testid="extensions-loaded">
                  <summary className="cursor-pointer text-xs text-zinc-600 dark:text-zinc-400">
                    {extensionPaths.length} {extensionPaths.length === 1 ? "extension" : "extensions"} loaded
                  </summary>
                  {/* Inventory, not settings: what the session actually loaded, the
                      deployment's and the user's together. What can be added and
                      removed is the path list below. */}
                  <ul className="mt-2 space-y-1">
                    {sorted(extensionPaths).map((p) => (
                      <li key={p} className="truncate rounded bg-zinc-50 px-2 py-1 font-mono text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400" title={p}>
                        {p}
                      </li>
                    ))}
                  </ul>
                </details>
              )}

              {configuredExtensionPaths.length > 0 && (
                <details className="mt-2" data-testid="extensions-configured">
                  <summary className="cursor-pointer text-xs text-zinc-600 dark:text-zinc-400">
                    {configuredExtensionPaths.length} configured by this deployment
                  </summary>
                  <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
                    Declared in the configuration file. They load either way, and nothing here can remove them.
                  </p>
                  <ul className="mt-1 space-y-1">
                    {sorted(configuredExtensionPaths).map((p) => (
                      <li key={p} className="truncate rounded bg-zinc-50 px-2 py-1 font-mono text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400" title={p}>
                        {p}
                      </li>
                    ))}
                  </ul>
                </details>
              )}

              {extensionLock ? (
                <p className="mt-2 text-xs text-zinc-400 dark:text-zinc-500" data-testid="extensions-locked">
                  Extension paths and repository updates that contain extensions are locked by this deployment.
                </p>
              ) : null}
            </section>

            {/* Sandbox section */}
            {sandbox && (
              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  Sandbox
                </h3>
                  <div className="space-y-3">
                    <label className="block">
                      <span className="text-xs text-zinc-600 dark:text-zinc-400">
                        Root {sandbox.locks?.root ? <span className="text-zinc-400">(locked)</span> : null}
                      </span>
                      <div className="mt-1 flex gap-2">
                        <input
                          type="text"
                          value={sandboxRoot}
                          onChange={(e) => setSandboxRoot(e.target.value)}
                          disabled={sandbox.locks?.root}
                          className="w-full rounded-md border border-zinc-300 bg-transparent px-2 py-1 text-sm outline-none focus:border-zinc-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:focus:border-zinc-500"
                        />
                        <button
                          type="button"
                          aria-label="Browse for sandbox root"
                          disabled={sandbox.locks?.root}
                          onClick={() => startPicking("root", sandboxRoot)}
                          className="shrink-0 rounded-md border border-zinc-300 px-2 py-1 text-xs text-zinc-600 hover:border-zinc-400 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300"
                        >
                          Browse…
                        </button>
                      </div>
                    </label>
                    {picking === "root" && picker}
                    <label className="block">
                      <span className="text-xs text-zinc-600 dark:text-zinc-400">
                        Writable root (optional) {sandbox.locks?.writableRoot ? <span className="text-zinc-400">(locked)</span> : null}
                      </span>
                      <div className="mt-1 flex gap-2">
                        <input
                          type="text"
                          value={sandboxWritableRoot}
                          onChange={(e) => setSandboxWritableRoot(e.target.value)}
                          disabled={sandbox.locks?.writableRoot}
                          placeholder="Same as root"
                          className="w-full rounded-md border border-zinc-300 bg-transparent px-2 py-1 text-sm outline-none placeholder:text-zinc-400 focus:border-zinc-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:placeholder:text-zinc-600 dark:focus:border-zinc-500"
                        />
                        <button
                          type="button"
                          aria-label="Browse for writable root"
                          disabled={sandbox.locks?.writableRoot}
                          onClick={() => startPicking("writableRoot", sandboxWritableRoot || sandboxRoot)}
                          className="shrink-0 rounded-md border border-zinc-300 px-2 py-1 text-xs text-zinc-600 hover:border-zinc-400 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300"
                        >
                          Browse…
                        </button>
                      </div>
                    </label>
                    {picking === "writableRoot" && picker}
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={sandboxAllowWrite}
                        onChange={(e) => setSandboxAllowWrite(e.target.checked)}
                        disabled={sandbox.locks?.allowWrite}
                        className="rounded border-zinc-300 text-zinc-700 focus:ring-zinc-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                      />
                      <span className="text-xs text-zinc-600 dark:text-zinc-400">
                        Allow write {sandbox.locks?.allowWrite ? <span className="text-zinc-400">(locked)</span> : null}
                      </span>
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={sandboxAllowBash}
                        onChange={(e) => setSandboxAllowBash(e.target.checked)}
                        disabled={sandbox.locks?.allowBash}
                        className="rounded border-zinc-300 text-zinc-700 focus:ring-zinc-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                      />
                      <span className="text-xs text-zinc-600 dark:text-zinc-400">
                        Allow bash {sandbox.locks?.allowBash ? <span className="text-zinc-400">(locked)</span> : null}
                      </span>
                    </label>
                </div>
              </section>
            )}
            {!sandbox && (
              <p className="text-xs text-zinc-400 dark:text-zinc-500">No sandbox configured</p>
            )}

            {sandbox && <div className="mt-4 space-y-2">
              {applyError && (
                <p role="alert" className="rounded-md border border-red-300 bg-red-50 px-2 py-1 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
                  {applyError}
                </p>
              )}
              <button
                type="button"
                disabled={applying || (sandbox !== null && !sandboxRoot.trim())}
                onClick={handleApply}
                className="w-full rounded-md bg-zinc-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-200 dark:text-zinc-900 dark:hover:bg-zinc-300"
              >
                {applying ? "Applying…" : "Apply & restart session"}
              </button>
              <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
                Saved to the server's configuration file, then the session is rebuilt — the change survives a restart.
              </p>
            </div>}

            {/* Versions section */}
            {versions && (
              <section className="mt-4">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  Versions
                </h3>
                <div className="space-y-1 text-xs text-zinc-600 dark:text-zinc-400">
                  <p>
                    pi-outpost: <span className="font-mono text-zinc-800 dark:text-zinc-200">{versions.piOutpost}</span>
                  </p>
                  {/* Whichever of the two is answering prompts — never both, or the
                      one that is not doing the work reads as the one that is. */}
                  {versions.piSdk && (
                    <p>
                      pi SDK: <span className="font-mono text-zinc-800 dark:text-zinc-200">{versions.piSdk}</span>
                    </p>
                  )}
                  {versions.agent && (
                    <p>
                      agent: <span className="font-mono text-zinc-800 dark:text-zinc-200">{versions.agent}</span>
                    </p>
                  )}
                </div>
              </section>
            )}
          </div>
        </div>
      )}
      <AgentResourceManager
        open={resourcesOpen}
        inventory={agentResources}
        operations={agentResourceOperations}
        extensionLock={extensionLock}
        userSkillPaths={userSkillPaths}
        userExtensionPaths={userExtensionPaths}
        serverBrowse={serverBrowse}
        applyState={applyState}
        onClose={() => {
          setResourcesOpen(false);
          onCloseServerBrowser();
          settingsButtonRef.current?.focus();
        }}
        onBrowseServerPath={(path) => {
          onPickerOpened?.();
          onBrowseServerPath(path);
        }}
        onCloseServerBrowser={onCloseServerBrowser}
        onUpdateConfig={onUpdateConfig}
        onSuggestClonePath={onSuggestAgentResourceClonePath}
        onCloneRepository={onCloneAgentResourceRepository}
        onEnrollRepository={onEnrollAgentResourceRepository}
        onRefresh={onRefreshAgentResourceRepositories}
        onUpdate={onUpdateAgentResourceRepository}
      />
    </div>
  );
}
