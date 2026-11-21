/**
 * "The agent has no shell on this machine" — said once, as a dialog, when the shell the server chose
 * (`"auto"`) turns out unable to be confined here.
 *
 * The padlock alone said `⛔ shell unavailable`, its reason in a tooltip: a colleague on a Windows 11
 * that lacked the August 2026 update met a shell that refused everything without being told why or
 * what to do. A machine that cannot confine is not a detail to hover over — but it is also not news
 * to repeat at every start: dismissing it is remembered in this browser for that cause, and the
 * padlock opens it again.
 *
 * Nothing here loosens the sandbox. Running commands unconfined stays a decision written in the
 * configuration file; the dialog names the line and what it costs, it does not set it.
 */
import { useEffect, useId, useRef } from "react";
import type { ConfinementVerdict } from "@pi-outpost/shared";

const SEEN_KEY = "pi-outpost:shell-unavailable-seen";

/** What makes one notice another: the reason the server gave, which names the build and the fix. */
export function shellNoticeKey(verdict: Extract<ConfinementVerdict, { state: "unavailable" }>): string {
  return verdict.reason;
}

/** Whether this browser has dismissed the notice for this cause. */
export function shellNoticeSeen(key: string): boolean {
  try {
    return window.localStorage.getItem(SEEN_KEY) === key;
  } catch {
    return false;
  }
}

function markSeen(key: string): void {
  try {
    window.localStorage.setItem(SEEN_KEY, key);
  } catch {
    // Not remembered: it is shown again next time, which is the safe side.
  }
}

const primaryButton =
  "rounded-md bg-zinc-900 px-3 py-1.5 text-sm text-zinc-100 hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white";
const plainButton =
  "rounded-md border border-zinc-200 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800";

export function ShellUnavailableDialog({
  verdict,
  onClose,
}: {
  verdict: Extract<ConfinementVerdict, { state: "unavailable" }>;
  onClose: () => void;
}) {
  const titleId = useId();
  const bodyId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const remedy = verdict.remedy?.kind === "windows-update" ? verdict.remedy : undefined;

  const close = () => {
    markSeen(shellNoticeKey(verdict));
    onClose();
  };

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/55 p-4" data-testid="shell-unavailable-backdrop">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        data-testid="shell-unavailable-dialog"
        className="w-full max-w-lg rounded-xl bg-white p-5 text-sm text-zinc-700 shadow-2xl dark:bg-zinc-900 dark:text-zinc-300"
      >
        <h2 id={titleId} className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
          The agent has no shell on this machine
        </h2>
        <div id={bodyId} className="mt-3 space-y-3">
          {remedy ? (
            <p data-testid="shell-unavailable-cause">
              This Windows (build {remedy.build}) lacks {remedy.update}. Without it, MXC cannot confine a command, and pi-outpost runs no
              command unconfined: the agent can read and edit the project's files, but not run a command, and a confined terminal cannot
              open.
            </p>
          ) : (
            <p data-testid="shell-unavailable-cause" className="break-words">
              {verdict.reason}
            </p>
          )}
          {remedy ? (
            <p>
              <span className="font-medium text-zinc-900 dark:text-zinc-100">To fix it:</span> install the update with Windows Update (build{" "}
              {remedy.needed} or later), then restart pi-outpost.
            </p>
          ) : null}
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Meanwhile, to run commands unconfined, set <code className="font-mono">"sandbox.bashRunner": "none"</code> in{" "}
            <code className="font-mono">pi-outpost.config.json</code>: they then run with every right of your account.
          </p>
        </div>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          {remedy ? (
            <a href="ms-settings:windowsupdate" className={plainButton} data-testid="shell-unavailable-windows-update">
              Open Windows Update
            </a>
          ) : null}
          <button ref={closeRef} type="button" onClick={close} className={primaryButton} data-testid="shell-unavailable-continue">
            Continue without a shell
          </button>
        </div>
      </div>
    </div>
  );
}
