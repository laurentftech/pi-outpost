/**
 * The npm pi packages the agent loads, in Settings: versions, newer ones, and the
 * actions that change them — update, add, remove, and undo a removal.
 *
 * Every change is code running with the agent's privileges changing, so it is confirmed
 * in place, naming what changes. It takes effect on a restart — a running server cannot
 * load or unload an extension's code — and the list says so rather than implying the
 * change runs. A removed package therefore stays listed, still running, until then, and
 * can be put back. The restart itself is `RestartNeeded`'s, shared with repositories.
 *
 * The section holds still: one text size, two fixed action slots per row whether or
 * not an action is offered, labels that never change while they run — progress,
 * outcomes and refusals are the row's status line, and the add form's message sits
 * below its buttons.
 */
import { useEffect, useRef, useState } from "react";
import type { PiPackageInfo } from "@pi-outpost/shared";
import type { AgentState } from "../useAgent";

type Scope = PiPackageInfo["scope"];

/** Adding and removing packages; absent where a host offers only updates. */
export interface PiPackageEdits {
  lookup: AgentState["piPackageLookup"];
  change: AgentState["piPackageChange"];
  /** The project a package added "for this project only" goes to, named in the choice. */
  projectName: string;
  onLookup: (name: string, version: string | undefined, scope: Scope) => void;
  onCloseLookup: () => void;
  /** `confirmed` is the version the confirmation named; the server installs that one or refuses. */
  onInstall: (name: string, version: string | undefined, scope: Scope, confirmed: string) => void;
  onRemove: (entry: PiPackageInfo) => void;
  onRestore: (entry: PiPackageInfo) => void;
}

interface PiPackagesProps {
  packages: PiPackageInfo[] | null;
  update: AgentState["piPackageUpdate"];
  /** Extension changes are locked by the deployment: nothing is offered. */
  locked: boolean;
  onCheck: () => void;
  onUpdate: (source: string) => void;
  edits?: PiPackageEdits;
}

function status(entry: PiPackageInfo): string {
  if (entry.removed) return "removed — still running until pi-outpost restarts";
  if (entry.installed === undefined) return "not installed";
  if (entry.restartNeeded) return `${entry.installed} installed — restart to use it`;
  if (entry.pinned !== undefined) return `${entry.installed}, pinned`;
  const check = entry.check;
  if (!check) return entry.installed;
  switch (check.state) {
    case "checking":
      return `${entry.installed}, checking…`;
    case "newer":
      return `${entry.installed} — ${check.latest} available`;
    case "current":
      return `${entry.installed}, up to date`;
    case "failed":
      return `${entry.installed}, not checked: ${check.reason}`;
    case "off":
      return `${entry.installed}, not checked: ${check.reason}`;
  }
}

/** `openlore`, `npm:@scope/name`, `name@1.2.3`: the name, and the version when one is given. */
export function parsePackageInput(text: string): { name: string; version?: string } {
  const spec = text.trim().replace(/^npm:/, "");
  const at = spec.lastIndexOf("@");
  return at > 0 ? { name: spec.slice(0, at), version: spec.slice(at + 1) } : { name: spec };
}

const keyOf = (entry: { scope: Scope; name: string }) => `${entry.scope}:${entry.name}`;
const where = (scope: Scope, project: string) => (scope === "user" ? "all projects" : `the ${project} project`);

const slotButton =
  "w-16 shrink-0 rounded border border-zinc-300 px-1.5 py-0.5 text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-700";
const slotQuiet =
  "w-16 shrink-0 rounded border border-transparent px-1.5 py-0.5 text-zinc-600 hover:bg-zinc-100 hover:text-red-700 disabled:opacity-50 dark:text-zinc-300 dark:hover:bg-zinc-700 dark:hover:text-red-400";
const amberBox = "mt-1 rounded border border-amber-300 bg-amber-50 p-2 text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200";
const amberGo = "rounded bg-amber-600 px-2 py-0.5 text-white hover:bg-amber-700";
const amberNo = "rounded px-2 py-0.5 hover:bg-amber-100 dark:hover:bg-amber-900/40";

/** The same size as a button, and invisible: a row whose action is absent keeps its layout. */
const Placeholder = () => <span aria-hidden="true" className={`${slotButton} invisible`}>Update</span>;

export function PiPackages({ packages, update, locked, onCheck, onUpdate, edits }: PiPackagesProps) {
  const [confirming, setConfirming] = useState<{ kind: "update" | "remove"; key: string } | null>(null);
  if (packages === null) return null;
  // Without the add and remove actions, an empty list has nothing to offer: as before.
  if (packages.length === 0 && !edits) return null;

  const updating = update?.status === "pending" ? update.source : null;
  const change = edits?.change ?? null;
  const changing = change?.status === "pending" ? change : null;
  const busy = updating !== null || changing !== null || edits?.lookup?.status === "pending";
  const canEdit = !locked && edits !== undefined;

  /** The status line: what runs now, what is happening to it, or what was refused. */
  function line(entry: PiPackageInfo): { text: string; warn: boolean } {
    if (updating === entry.source && entry.check?.state === "newer") return { text: `updating to ${entry.check.latest}…`, warn: false };
    if (changing && changing.key === keyOf(entry)) {
      if (changing.action === "remove") return { text: "removing…", warn: false };
      if (changing.action === "restore") return { text: `reinstalling ${entry.loaded ?? ""}…`, warn: false };
    }
    if (update && update.status !== "pending" && update.status !== "installed" && update.source === entry.source) return { text: update.message, warn: true };
    if (change && (change.status === "failed" || change.status === "refused") && change.key === keyOf(entry) && change.action !== "install") {
      return { text: change.message, warn: true };
    }
    return { text: status(entry), warn: false };
  }

  return (
    <div className="mt-3 text-xs" data-testid="pi-packages">
      <div className="mb-1 flex items-center justify-between">
        <span className="font-medium text-zinc-600 dark:text-zinc-400">Packages</span>
        {packages.length > 0 && (
          <button type="button" onClick={onCheck} className="text-zinc-500 underline hover:text-zinc-800 dark:hover:text-zinc-200">
            check for updates
          </button>
        )}
      </div>
      {packages.length === 0 && <p className="text-zinc-500 dark:text-zinc-400" data-testid="pi-packages-empty">No packages installed</p>}
      <ul className="space-y-1">
        {packages.map((entry) => {
          const key = keyOf(entry);
          const newer = entry.check?.state === "newer" && !entry.restartNeeded && !entry.removed ? entry.check.latest : undefined;
          const open = confirming?.key === key ? confirming.kind : null;
          const { text, warn } = line(entry);
          return (
            <li key={`${key}:${entry.source}`} data-testid="pi-package" className="rounded bg-zinc-50 px-2 py-1 dark:bg-zinc-800">
              <div className="flex items-center justify-between gap-2">
                <span
                  className={`min-w-0 flex-1 truncate font-medium ${entry.removed ? "text-zinc-400 line-through dark:text-zinc-500" : "text-zinc-700 dark:text-zinc-200"}`}
                  title={entry.source}
                >
                  {entry.name}
                </span>
                {!locked &&
                  (newer ? (
                    <button type="button" disabled={busy || open !== null} onClick={() => setConfirming({ kind: "update", key })} className={slotButton}>
                      Update
                    </button>
                  ) : (
                    <Placeholder />
                  ))}
                {canEdit &&
                  (entry.removed ? (
                    <button type="button" disabled={busy} onClick={() => edits.onRestore(entry)} className={slotButton} title={`Put ${entry.name} back as it was`}>
                      Undo
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={busy || open !== null}
                      onClick={() => setConfirming({ kind: "remove", key })}
                      className={slotQuiet}
                      aria-label={`Remove ${entry.name}`}
                    >
                      Remove
                    </button>
                  ))}
              </div>
              <div className={`truncate ${warn ? "text-amber-700 dark:text-amber-400" : "text-zinc-500 dark:text-zinc-400"}`} title={text}>
                {entry.scope === "project" && <span>this project · </span>}
                <span data-testid="pi-package-status">{text}</span>
              </div>
              {newer && open === "update" && (
                <div className={amberBox} data-testid="pi-package-confirm">
                  <p>
                    This replaces code that runs with the agent's privileges: {entry.name} {entry.installed} → {newer}. It takes
                    effect when pi-outpost restarts.
                  </p>
                  <div className="mt-1 flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setConfirming(null);
                        onUpdate(entry.source);
                      }}
                      className={amberGo}
                    >
                      Install {newer}
                    </button>
                    <button type="button" onClick={() => setConfirming(null)} className={amberNo}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
              {edits && open === "remove" && (
                <div className={amberBox} data-testid="pi-package-confirm">
                  <p>
                    Removes {entry.name} from {entry.scope === "user" ? "the agent's settings (all projects)" : `the ${edits.projectName} project's settings`}{" "}
                    and uninstalls it. The agent keeps running it until pi-outpost restarts.
                  </p>
                  <div className="mt-1 flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setConfirming(null);
                        edits.onRemove(entry);
                      }}
                      className={amberGo}
                    >
                      Remove
                    </button>
                    <button type="button" onClick={() => setConfirming(null)} className={amberNo}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {/* Keyed by project: a half-typed name or a scope chosen for one project is not another's. */}
      {canEdit && <AddPackage key={edits.projectName} edits={edits} busy={busy} />}
    </div>
  );
}

/** The add action: a name, a scope, a look at the registry, then a confirmation. */
function AddPackage({ edits, busy }: { edits: PiPackageEdits; busy: boolean }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [scope, setScope] = useState<Scope>("user");
  const input = useRef<HTMLInputElement>(null);
  const { lookup, change } = edits;
  const installing = change?.status === "pending" && change.action === "install" ? change : null;
  const installFailed = change && change.action === "install" && (change.status === "failed" || change.status === "refused") ? change.message : null;
  // The answer to what is in the field now: one about a name since retyped is not shown.
  const asked = parsePackageInput(draft);
  const current = lookup && lookup.name === asked.name && lookup.version === asked.version && lookup.scope === scope ? lookup : null;

  // Installed: the form has done its job (the hook dropped the lookup with it).
  useEffect(() => {
    if (change?.action === "install" && change.status === "installed") {
      setOpen(false);
      setDraft("");
      setScope("user");
    }
  }, [change]);

  useEffect(() => {
    if (open && current?.status !== "found") input.current?.focus();
  }, [open, current?.status]);

  // Each add starts from the default: a project choice left over would write into the
  // repository's settings without the user choosing it again.
  const close = () => {
    setOpen(false);
    setDraft("");
    setScope("user");
    edits.onCloseLookup();
  };

  if (installing) {
    return (
      <p className="mt-1 text-zinc-500 dark:text-zinc-400" role="status">
        installing {installing.key.slice(installing.key.indexOf(":") + 1)}…
      </p>
    );
  }

  if (!open) {
    return (
      <>
        {installFailed && <p className="mt-1 text-amber-700 dark:text-amber-400" role="alert">{installFailed}</p>}
        <button
          type="button"
          disabled={busy}
          onClick={() => setOpen(true)}
          className="mt-1 text-zinc-500 underline hover:text-zinc-800 disabled:opacity-50 dark:hover:text-zinc-200"
        >
          Add a package
        </button>
      </>
    );
  }

  if (current?.status === "found") {
    return (
      <div className={amberBox} data-testid="pi-package-add-confirm">
        <p>
          This installs code that runs with the agent's privileges: {current.name} {current.resolved}
          {current.version !== undefined ? " (pinned)" : ""}, for {where(current.scope, edits.projectName)}. It takes effect when
          pi-outpost restarts.
        </p>
        <div className="mt-1 flex gap-2">
          <button type="button" disabled={busy} onClick={() => edits.onInstall(current.name, current.version, current.scope, current.resolved)} className={amberGo}>
            Install {current.name}
          </button>
          <button type="button" onClick={() => edits.onCloseLookup()} className={amberNo}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // A lookup under way or answered speaks for the field; otherwise a failed install does.
  const message = current ? (current.status === "refused" ? current.message : null) : installFailed;
  return (
    <form
      className="mt-1 rounded border border-zinc-200 p-2 dark:border-zinc-700"
      onSubmit={(event) => {
        event.preventDefault();
        if (!asked.name || busy) return;
        edits.onLookup(asked.name, asked.version, scope);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          close();
        }
      }}
    >
      <label className="block text-zinc-600 dark:text-zinc-400" htmlFor="pi-package-name">
        npm package
      </label>
      <input
        id="pi-package-name"
        ref={input}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        disabled={current?.status === "pending"}
        autoComplete="off"
        spellCheck={false}
        placeholder="openlore, @scope/name or name@1.2.3"
        className="mt-0.5 w-full rounded border border-zinc-300 bg-white px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-blue-400 dark:border-zinc-600 dark:bg-zinc-800"
      />
      <fieldset className="mt-2 flex flex-wrap gap-x-3 text-zinc-600 dark:text-zinc-400">
        <legend className="sr-only">Install for</legend>
        <label>
          <input type="radio" name="pi-package-scope" checked={scope === "user"} onChange={() => setScope("user")} /> all projects
        </label>
        <label>
          <input type="radio" name="pi-package-scope" checked={scope === "project"} onChange={() => setScope("project")} /> this project only (
          {edits.projectName})
        </label>
      </fieldset>
      <div className="mt-2 flex justify-end gap-2">
        <button type="button" onClick={close} className="rounded px-2 py-0.5 hover:bg-zinc-100 dark:hover:bg-zinc-700">
          Cancel
        </button>
        <button type="submit" disabled={busy || !asked.name} className={slotButton.replace("w-16 ", "")}>
          Install…
        </button>
      </div>
      <p
        className={`mt-1 min-h-[1rem] ${message ? "text-amber-700 dark:text-amber-400" : "text-zinc-500 dark:text-zinc-400"}`}
        role={message ? "alert" : "status"}
      >
        {message ?? (current?.status === "pending" ? `looking up ${current.name}…` : "")}
      </p>
    </form>
  );
}
