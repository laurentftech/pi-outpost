import type { AgentStatus } from "../agentStatus";

function label(status: AgentStatus): string {
  switch (status.kind) {
    case "idle":
      return "π is idle";
    case "replying":
      return "π is replying…";
    case "tool":
      return `π is running ${status.tool}…`;
    case "failed":
      return "π hit an error";
    case "done":
      return "π replied";
    case "needsYou":
      return status.what === "question" ? "π needs you — a question is waiting" : "π needs you — a permission request is waiting";
  }
}

function detail(status: AgentStatus): string {
  if (status.kind === "replying" || status.kind === "done") return status.lastLine;
  if (status.kind === "failed") return status.error;
  return "";
}

/** A pointer press on these must not pull focus out of the editor the user is writing in. */
export const keepFocus = (event: React.MouseEvent) => event.preventDefault();

const DOT: Record<AgentStatus["kind"], string> = {
  idle: "bg-zinc-300 dark:bg-zinc-600",
  replying: "bg-amber-500 animate-pulse",
  tool: "bg-amber-500 animate-pulse",
  failed: "bg-red-500",
  done: "bg-emerald-500",
  needsYou: "bg-red-500 animate-pulse",
};

/**
 * The file viewer's bottom strip while it covers the chat: what the agent is
 * doing, and the two ways to see it without closing the file — a look at the
 * conversation, or the file beside it. Nothing here takes focus by itself.
 */
export function AgentStatusStrip({
  status,
  onRevealConversation,
  onBesideChat,
}: {
  status: AgentStatus;
  onRevealConversation?: () => void;
  /** Absent when there is no room to put the file beside the conversation. */
  onBesideChat?: () => void;
}) {
  const urgent = status.kind === "needsYou" || status.kind === "failed";
  const text = detail(status);
  return (
    <div
      className={`flex min-w-0 items-center gap-2 border-t px-3 py-1.5 text-sm ${
        urgent ? "border-red-300 bg-red-50 dark:border-red-900/60 dark:bg-red-950/30" : "border-zinc-200 dark:border-zinc-800"
      }`}
    >
      {/* Only the state is a live region: the last line changes with every streamed
          token, and announcing it would read the reply out a token at a time. */}
      <span role="status" aria-live="polite" className="flex shrink-0 items-center gap-2">
        <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full motion-reduce:animate-none ${DOT[status.kind]}`} />
        <span className={status.kind === "idle" ? "text-zinc-400 dark:text-zinc-500" : "font-medium text-zinc-700 dark:text-zinc-200"}>
          {label(status)}
        </span>
      </span>
      {text && <span className="min-w-0 truncate text-zinc-500 dark:text-zinc-400" title={text}>{text}</span>}
      <span className="ml-auto flex shrink-0 items-center gap-1">
        {onRevealConversation && (
          <button
            type="button"
            onMouseDown={keepFocus}
            onClick={onRevealConversation}
            className="min-h-6 rounded px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            conversation ↗
          </button>
        )}
        {onBesideChat && (
          <button
            type="button"
            onMouseDown={keepFocus}
            onClick={onBesideChat}
            title="Show the file beside the conversation"
            className="min-h-6 rounded border border-zinc-300 px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            ◫ beside chat
          </button>
        )}
      </span>
    </div>
  );
}
