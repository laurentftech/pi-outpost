/**
 * The npm pi packages the agent loads, in Settings: versions, newer ones, and the one
 * action that changes them.
 *
 * Updating is code running with the agent's privileges changing, so it is confirmed in
 * place, naming both versions. An installed update takes effect on a restart — a running
 * server cannot load an extension's new code — and the list says so rather than implying
 * the new version runs.
 */
import { useState } from "react";
import type { PiPackageInfo } from "@pi-outpost/shared";
import type { AgentState } from "../useAgent";

interface PiPackagesProps {
  packages: PiPackageInfo[] | null;
  update: AgentState["piPackageUpdate"];
  /** Extension changes are locked by the deployment: nothing is offered. */
  locked: boolean;
  /** The standalone interface may restart the server; a widget may not. */
  canRestart: boolean;
  restarting: boolean;
  onCheck: () => void;
  onUpdate: (source: string) => void;
  onRestart: () => void;
}

function status(entry: PiPackageInfo): string {
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

export function PiPackages({ packages, update, locked, canRestart, restarting, onCheck, onUpdate, onRestart }: PiPackagesProps) {
  const [confirming, setConfirming] = useState<string | null>(null);
  const [confirmingRestart, setConfirmingRestart] = useState(false);
  if (packages === null || packages.length === 0) return null;
  const pending = update?.status === "pending" ? update.source : null;
  const needsRestart = packages.some((entry) => entry.restartNeeded);

  return (
    <div className="mt-3" data-testid="pi-packages">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Packages</span>
        <button type="button" onClick={onCheck} className="text-xs text-zinc-500 underline hover:text-zinc-800 dark:hover:text-zinc-200">
          check for updates
        </button>
      </div>
      <ul className="space-y-1">
        {packages.map((entry) => {
          const newer = entry.check?.state === "newer" && !entry.restartNeeded ? entry.check.latest : undefined;
          return (
            <li key={entry.source} data-testid="pi-package" className="rounded bg-zinc-50 px-2 py-1 text-xs dark:bg-zinc-800">
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate font-mono text-zinc-700 dark:text-zinc-300" title={entry.source}>
                  {entry.name}
                </span>
                {newer && !locked && confirming !== entry.source && (
                  <button
                    type="button"
                    disabled={pending !== null}
                    onClick={() => setConfirming(entry.source)}
                    className="shrink-0 rounded border border-zinc-300 px-1.5 py-0.5 text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-700"
                  >
                    {pending === entry.source ? "updating…" : "Update"}
                  </button>
                )}
              </div>
              <div className="text-zinc-500 dark:text-zinc-400" data-testid="pi-package-status">
                {status(entry)}
              </div>
              {newer && confirming === entry.source && (
                <div className="mt-1 rounded border border-amber-300 bg-amber-50 p-2 text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200" data-testid="pi-package-confirm">
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
                      className="rounded bg-amber-600 px-2 py-0.5 text-white hover:bg-amber-700"
                    >
                      Install {newer}
                    </button>
                    <button type="button" onClick={() => setConfirming(null)} className="rounded px-2 py-0.5 hover:bg-amber-100 dark:hover:bg-amber-900/40">
                      Cancel
                    </button>
                  </div>
                </div>
              )}
              {update && update.status !== "pending" && update.source === entry.source && (
                <p
                  data-testid="pi-package-result"
                  className={`mt-1 ${update.status === "installed" ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400"}`}
                >
                  {update.message}
                </p>
              )}
            </li>
          );
        })}
      </ul>
      {needsRestart && canRestart && (
        <div className="mt-2" data-testid="pi-packages-restart">
          {restarting ? (
            <p className="text-xs text-zinc-500">Restarting pi-outpost…</p>
          ) : confirmingRestart ? (
            <div className="rounded border border-zinc-300 p-2 text-xs dark:border-zinc-600">
              <p className="text-zinc-700 dark:text-zinc-300">
                pi-outpost stops and starts again in the same terminal. Every open window reconnects by itself, and
                conversations are kept.
              </p>
              <div className="mt-1 flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setConfirmingRestart(false);
                    onRestart();
                  }}
                  className="rounded bg-zinc-800 px-2 py-0.5 text-white hover:bg-zinc-700 dark:bg-zinc-200 dark:text-zinc-900"
                >
                  Restart now
                </button>
                <button type="button" onClick={() => setConfirmingRestart(false)} className="rounded px-2 py-0.5 hover:bg-zinc-100 dark:hover:bg-zinc-800">
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingRestart(true)}
              className="rounded border border-zinc-300 px-2 py-0.5 text-xs text-zinc-700 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-700"
            >
              Restart pi-outpost to use the updates
            </button>
          )}
        </div>
      )}
    </div>
  );
}
