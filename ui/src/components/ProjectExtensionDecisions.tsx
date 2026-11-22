/**
 * What the user decided about this project's extensions (`project-extension-approval`): each one
 * allowed or refused for its content, and the way to withdraw it, after which it is asked about
 * again and not loaded until allowed.
 */
import { useEffect } from "react";
import type { ProjectExtensionDecision } from "@pi-outpost/shared";

export function ProjectExtensionDecisions({
  decisions,
  onLoad,
  onWithdraw,
}: {
  decisions: ProjectExtensionDecision[] | null;
  onLoad: () => void;
  onWithdraw: (kind: "file" | "package", key: string) => void;
}) {
  // Asked for each time Settings opens: another tab may have decided since.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => onLoad(), []);
  if (decisions === null || decisions.length === 0) return null;
  return (
    <details className="mt-2" data-testid="extension-decisions">
      <summary className="cursor-pointer text-xs text-zinc-600 dark:text-zinc-400">
        {decisions.length} of this project's {decisions.length === 1 ? "extension" : "extensions"} decided
      </summary>
      <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
        Allowed ones run outside the sandbox. A change to one asks again; withdrawing a decision asks at the next session.
      </p>
      <ul className="mt-1 space-y-1">
        {decisions.map((decision) => (
          <li
            key={`${decision.kind}:${decision.key}`}
            data-testid="extension-decision"
            data-decision={decision.decision}
            className="flex items-center gap-2 rounded bg-zinc-50 px-2 py-1 text-xs dark:bg-zinc-800"
          >
            <span className={decision.decision === "allow" ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"}>
              {decision.decision === "allow" ? "allowed" : "refused"}
            </span>
            <span className="min-w-0 flex-1 truncate font-mono text-zinc-700 dark:text-zinc-300" title={decision.label}>
              {decision.label}
            </span>
            <button
              type="button"
              className="shrink-0 text-zinc-500 underline hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
              data-testid="extension-decision-withdraw"
              onClick={() => onWithdraw(decision.kind, decision.key)}
            >
              withdraw
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}
