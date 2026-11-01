import { useEffect, useState } from "react";
import type { SandboxGrantDecision, SandboxGrantRequest } from "@pi-outpost/shared";

interface SandboxGrantDialogProps {
  request: SandboxGrantRequest;
  onRespond: (id: string, decision: SandboxGrantDecision) => void;
}

const buttonBase =
  "rounded-md border px-3 py-1.5 text-sm border-zinc-200 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-800 dark:hover:bg-zinc-800";
const primaryButton =
  "rounded-md bg-zinc-900 px-3 py-1.5 text-sm text-zinc-100 hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white";

const until = (epoch: number) => new Date(epoch).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/**
 * The user is asked about something beyond the sandbox: the agent asking to run a command with
 * directories outside it (nothing runs before the answer), or a running command connecting to a
 * host the sandbox does not list (that connection waits for the answer; the agent did not ask).
 *
 * Raised by the server alone, for its own shell — never by an extension, whose dialogs are
 * `ExtensionDialog`. What it shows is what will run: the command as given, every target with its
 * access, then the agent's reason, set apart as its words. "For this session" is a second,
 * deliberate choice and never the default. The dialog closes when the server says the request is
 * resolved — answered here, in another tab, expired or aborted — not when a button is pressed.
 */
export function SandboxGrantDialog({ request, onRespond }: SandboxGrantDialogProps) {
  const [answered, setAnswered] = useState<SandboxGrantDecision | null>(null);
  const [nudged, setNudged] = useState(false);

  useEffect(() => {
    if (!nudged) return;
    const timer = setTimeout(() => setNudged(false), 400);
    return () => clearTimeout(timer);
  }, [nudged]);

  // A new request in the same place starts unanswered.
  useEffect(() => setAnswered(null), [request.id]);

  function answer(decision: SandboxGrantDecision) {
    if (answered) return;
    setAnswered(decision);
    onRespond(request.id, decision);
  }

  const { hosts, directories } = request.grant;
  const connection = request.kind === "connection";
  return (
    // The agent waits on this answer: the backdrop does not dismiss it, it only points at the panel.
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setNudged(true)}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="sandbox-grant-title"
        data-testid="sandbox-grant-dialog"
        data-request-id={request.id}
        className={`w-full max-w-2xl rounded-xl border bg-white p-4 shadow-2xl transition-shadow dark:bg-zinc-900 ${
          nudged ? "border-zinc-400 ring-2 ring-zinc-400/60 dark:border-zinc-500 dark:ring-zinc-500/60" : "border-zinc-200 dark:border-zinc-700"
        }`}
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="sandbox-grant-title" className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          {connection ? `A running command is connecting to ${hosts.join(", ")}` : "The agent asks to run a command beyond its sandbox"}
        </h2>

        <div className="mb-1 text-xs font-medium text-zinc-500 dark:text-zinc-400">{connection ? "The running command" : "Command"}</div>
        <pre
          data-testid="sandbox-grant-command"
          className="mb-3 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-md bg-zinc-50 p-2 font-mono text-xs text-zinc-800 dark:bg-zinc-950 dark:text-zinc-200"
        >
          {request.command}
        </pre>

        <div className="mb-1 text-xs font-medium text-zinc-500 dark:text-zinc-400">{connection ? "It is waiting to reach" : "It would also reach"}</div>
        <ul data-testid="sandbox-grant-targets" className="mb-3 list-disc pl-5 text-sm text-zinc-800 dark:text-zinc-200">
          {hosts.map((host) => (
            <li key={`host:${host}`}>
              host <code className="font-mono">{host}</code>
            </li>
          ))}
          {directories.map((directory) => (
            <li key={`dir:${directory.path}`}>
              {directory.access === "write" ? "read and write" : "read"} <code className="break-all font-mono">{directory.path}</code>
            </li>
          ))}
        </ul>

        {request.overridesReadOnly && (
          <p data-testid="sandbox-grant-overrides" className="mb-3 rounded-md bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
            Writing is off in this project's sandbox: allowing this lets the command write there anyway.
          </p>
        )}

        {connection ? (
          <p data-testid="sandbox-grant-reason" className="mb-4 text-sm text-zinc-600 dark:text-zinc-400">
            Not in this sandbox's allowed hosts. The agent did not ask for it: the command connected, and waits for your answer.
          </p>
        ) : (
          <>
            <div className="mb-1 text-xs font-medium text-zinc-500 dark:text-zinc-400">The agent says</div>
            <blockquote data-testid="sandbox-grant-reason" className="mb-4 border-l-2 border-zinc-300 pl-2 text-sm italic text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
              {request.reason}
            </blockquote>
          </>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className="mr-auto text-xs text-zinc-500 dark:text-zinc-400">Refused if unanswered by {until(request.expiresAt)}</span>
          <button type="button" className={buttonBase} disabled={answered !== null} onClick={() => answer("refuse")}>
            Refuse
          </button>
          <button type="button" className={buttonBase} disabled={answered !== null} onClick={() => answer("session")}>
            Allow for this session
          </button>
          <button type="button" className={primaryButton} disabled={answered !== null} onClick={() => answer("once")}>
            {connection ? "Allow for this command" : "Allow once"}
          </button>
        </div>
      </div>
    </div>
  );
}
