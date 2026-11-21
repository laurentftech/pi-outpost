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
 * Two ways out, side by side: update Windows — not always the user's to do — or run commands
 * unconfined. Nothing here loosens the sandbox: that stays a command the user runs on this machine
 * (`pi-outpost config --unconfine`), and the dialog names it and what it costs, it does not run it.
 */
import { useEffect, useId, useRef, useState } from "react";
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

export const UNCONFINE_COMMAND = "pi-outpost config --unconfine";

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
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard?.writeText(UNCONFINE_COMMAND).then(
      () => setCopied(true),
      () => setCopied(false),
    );
  };

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
          <p className="font-medium text-zinc-900 dark:text-zinc-100">Two ways out:</p>
          <ol className="list-decimal space-y-3 pl-5">
            {remedy ? (
              <li data-testid="shell-unavailable-update">
                <span className="font-medium text-zinc-900 dark:text-zinc-100">Update Windows</span> to build {remedy.needed} or later, then
                restart pi-outpost. The shell is then confined, with nothing to change.
              </li>
            ) : null}
            <li data-testid="shell-unavailable-unconfine">
              <span className="font-medium text-zinc-900 dark:text-zinc-100">{remedy ? "If you cannot update Windows, run" : "Run"} commands unconfined.</span>{" "}
              On this machine, run
              <span className="mt-1.5 flex items-center gap-2">
                <code className="select-all rounded bg-zinc-100 px-2 py-1 font-mono text-xs text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100">
                  {UNCONFINE_COMMAND}
                </code>
                <button type="button" onClick={copy} className="text-xs text-zinc-500 underline hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200" data-testid="shell-unavailable-copy">
                  {copied ? "copied" : "copy"}
                </button>
              </span>
              <span className="mt-1.5 block">
                then restart pi-outpost. It sets <code className="font-mono">"sandbox.bashRunner": "none"</code> in the configuration file.{" "}
                <span className="font-medium text-red-700 dark:text-red-400">
                  The agent's commands then run with every right of your account: they can read, change and delete any file you can, outside
                  the project too.
                </span>{" "}
                <code className="font-mono">pi-outpost config --confine</code> confines them again once this machine can.
              </span>
            </li>
          </ol>
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
