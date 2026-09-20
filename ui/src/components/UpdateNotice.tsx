/**
 * "A newer pi-outpost is available" — the standalone app's notice, and nothing more.
 *
 * It never installs: moving the running server is `pi-outpost update`'s job, in a
 * terminal. Dismissing it is remembered per version in this browser — a convenience for
 * this viewer, not state anyone else needs — so the next version is announced again.
 */
import { useState } from "react";
import type { OutpostUpdateNotice } from "@pi-outpost/shared";
import { CopyButton } from "./CopyButton";

const DISMISSED_KEY = "pi-outpost:update-notice-dismissed";

function dismissedVersion(): string | null {
  try {
    return window.localStorage.getItem(DISMISSED_KEY);
  } catch {
    return null;
  }
}

export function UpdateNotice({ notice }: { notice: OutpostUpdateNotice }) {
  const [dismissed, setDismissed] = useState(() => dismissedVersion());
  if (dismissed === notice.latest) return null;
  return (
    <div
      role="status"
      data-testid="update-notice"
      className="flex items-center gap-2 border-b border-sky-200 bg-sky-50 px-4 py-1.5 text-xs text-sky-900 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-200"
    >
      <span className="min-w-0 flex-1">
        pi-outpost {notice.latest} is available (you have {notice.running}). {notice.instruction}
      </span>
      <code className="shrink-0 rounded bg-white/70 px-1.5 py-0.5 font-mono dark:bg-sky-900/40">{notice.copy}</code>
      <CopyButton text={notice.copy} />
      <button
        type="button"
        aria-label="Dismiss the update notice"
        onClick={() => {
          try {
            window.localStorage.setItem(DISMISSED_KEY, notice.latest);
          } catch {
            // Storage refused: the notice goes for now and comes back next time.
          }
          setDismissed(notice.latest);
        }}
        className="shrink-0 rounded px-1.5 text-sky-700 hover:bg-sky-100 dark:text-sky-300 dark:hover:bg-sky-900/50"
      >
        ×
      </button>
    </div>
  );
}
