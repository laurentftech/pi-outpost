/**
 * "This project has an extension pi has not loaded" — the user's say before it runs
 * (`project-extension-approval`).
 *
 * An extension the agent wrote, or one a cloned project brought, is a module pi would import into
 * the server: it runs outside the sandbox, with every right of the account. It is left out until
 * allowed for its content; this asks. The dialog closes when the server's list no longer holds the
 * question — answered here or in another tab — not when a button is pressed.
 */
import { useEffect, useId, useState } from "react";
import type { ProjectExtensionQuestion } from "@pi-outpost/shared";

const buttonBase =
  "rounded-md border px-3 py-1.5 text-sm border-zinc-200 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-800 dark:hover:bg-zinc-800";
const primaryButton =
  "rounded-md bg-zinc-900 px-3 py-1.5 text-sm text-zinc-100 hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white";

const bytes = (size: number) => (size < 1024 ? `${size} B` : size < 1024 * 1024 ? `${(size / 1024).toFixed(1)} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`);

export function ExtensionApprovalDialog({
  question,
  remaining,
  onAnswer,
  onView,
}: {
  question: ProjectExtensionQuestion;
  /** How many more wait after this one. */
  remaining: number;
  onAnswer: (id: string, decision: "allow" | "refuse") => void;
  /** Opens the file in the viewer; absent for a package. */
  onView?: (path: string) => void;
}) {
  const headingId = useId();
  const [answered, setAnswered] = useState(false);
  useEffect(() => setAnswered(false), [question.id]);

  const answer = (decision: "allow" | "refuse") => {
    if (answered) return;
    setAnswered(true);
    onAnswer(question.id, decision);
  };

  const isPackage = question.kind === "package";
  const isMcp = question.kind === "mcp";
  const viewable = !isPackage && question.path !== undefined && onView !== undefined;
  return (
    <section
      role="region"
      aria-labelledby={headingId}
      data-testid="extension-approval-dialog"
      data-question-id={question.id}
      className="flex max-h-[40dvh] flex-col overflow-hidden rounded-xl border border-amber-300 bg-white dark:border-amber-700 dark:bg-zinc-900"
    >
      <div className="min-h-0 overflow-y-auto overscroll-contain break-words p-4 text-sm text-zinc-700 dark:text-zinc-300">
        <h2 id={headingId} className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          {isPackage ? "This project asks pi to install a package" : isMcp ? "This project asks pi to start an MCP server" : "This project has an extension pi has not loaded"}
        </h2>
        <p className="mb-2">
          <code data-testid="extension-approval-label" className="break-all rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-xs text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100">
            {question.label}
          </code>
          {question.size !== undefined ? <span className="ml-2 text-xs text-zinc-500 dark:text-zinc-400">{bytes(question.size)}</span> : null}
        </p>
        <p data-testid="extension-approval-warning" className="mb-2 font-medium text-red-700 dark:text-red-400">
          {isPackage
            ? "Its extensions, and its install scripts, would run outside the sandbox, with every right of your account."
            : isMcp
              ? "It would run outside the sandbox, with every right of your account, and the agent could call its tools."
              : "It would run outside the sandbox, with every right of your account — and so would what it imports."}
        </p>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          The agent may have written it, or the project brought it. It is not loaded until you allow it, and a change to it asks
          again. Settings lists what you decided.
          {remaining > 0 ? ` ${remaining} more after this one.` : ""}
        </p>
      </div>
      <div className="flex flex-wrap justify-end gap-2 border-t border-zinc-200 px-4 py-3 dark:border-zinc-800">
        {viewable ? (
          <button type="button" className={buttonBase} data-testid="extension-approval-view" onClick={() => onView!(question.path!)}>
            View code
          </button>
        ) : null}
        <button type="button" className={buttonBase} disabled={answered} data-testid="extension-approval-refuse" onClick={() => answer("refuse")}>
          Refuse
        </button>
        <button type="button" className={primaryButton} disabled={answered} data-testid="extension-approval-allow" onClick={() => answer("allow")}>
          Allow
        </button>
      </div>
    </section>
  );
}
