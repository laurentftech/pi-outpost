import { useEffect, useRef, useState } from "react";
import type { SessionSummary } from "@pi-interface/shared";

interface HeaderProps {
  title?: string;
  sessions: SessionSummary[] | null;
  sessionId: string;
  isStreaming: boolean;
  connected: boolean;
  theme: "light" | "dark";
  showThemeToggle: boolean;
  onToggleTheme: () => void;
  onNewSession: () => void;
  onSwitchSession: (path: string) => void;
  onDeleteSession: (path: string) => void;
  onListSessions: () => void;
}

function useClickOutside(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function handler(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);
  return ref;
}

function SessionMenu({
  sessions,
  sessionId,
  onSwitchSession,
  onDeleteSession,
  onListSessions,
}: Pick<HeaderProps, "sessions" | "sessionId" | "onSwitchSession" | "onDeleteSession" | "onListSessions">) {
  const [open, setOpen] = useState(false);
  const ref = useClickOutside(() => setOpen(false));

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => {
          setOpen(!open);
          if (!open) onListSessions();
        }}
        className="rounded-md border border-zinc-300 px-2 py-1 text-xs text-zinc-500 hover:border-zinc-400 hover:text-zinc-700 dark:border-zinc-800 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:text-zinc-200"
      >
        sessions
      </button>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-1 max-h-96 w-96 overflow-y-auto rounded-lg border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
          {sessions === null && <div className="px-3 py-2 text-xs text-zinc-500">loading…</div>}
          {sessions?.length === 0 && <div className="px-3 py-2 text-xs text-zinc-500">no saved sessions</div>}
          {sessions?.map((session) => (
            <div
              key={session.path}
              className={`group flex items-start gap-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
                session.id === sessionId ? "bg-zinc-100 dark:bg-zinc-800/60" : ""
              }`}
            >
              <button
                type="button"
                onClick={() => {
                  onSwitchSession(session.path);
                  setOpen(false);
                }}
                className="min-w-0 flex-1 px-3 py-2 text-left text-sm"
              >
                <div className="truncate text-zinc-700 dark:text-zinc-300">
                  {session.name || session.firstMessage || "(empty)"}
                </div>
                <div className="mt-0.5 text-xs text-zinc-400 dark:text-zinc-600">
                  {new Date(session.modified).toLocaleString()} · {session.messageCount} messages
                  {session.id === sessionId ? " · current" : ""}
                </div>
              </button>
              {session.id !== sessionId && (
                <button
                  type="button"
                  onClick={() => onDeleteSession(session.path)}
                  title="delete session"
                  className="mr-2 mt-2 rounded px-1.5 py-0.5 text-xs text-zinc-400 opacity-0 hover:bg-red-100 hover:text-red-600 group-hover:opacity-100 dark:text-zinc-600 dark:hover:bg-red-950/60 dark:hover:text-red-400"
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ThemeToggle({ theme, onToggle }: { theme: "light" | "dark"; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
      className="rounded-md border border-zinc-300 px-2 py-1 text-xs text-zinc-500 hover:border-zinc-400 hover:text-zinc-700 dark:border-zinc-800 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:text-zinc-200"
    >
      {theme === "dark" ? "☀" : "☾"}
    </button>
  );
}

export function Header(props: HeaderProps) {
  const { isStreaming, connected } = props;

  return (
    <header className="flex items-center gap-3 border-b border-zinc-200 px-4 py-2.5 dark:border-zinc-800">
      <span className="text-lg font-semibold tracking-tight" style={{ color: "var(--accent, inherit)" }}>
        {props.title ?? "π"}
      </span>

      {isStreaming && (
        <span className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500 dark:bg-amber-400" />
          working
        </span>
      )}

      <div className="ml-auto flex items-center gap-2">
        {props.showThemeToggle && <ThemeToggle theme={props.theme} onToggle={props.onToggleTheme} />}
        <button
          type="button"
          onClick={props.onNewSession}
          title="new session"
          className="rounded-md border border-emerald-300 px-2 py-1 text-xs text-emerald-700 hover:border-emerald-500 hover:text-emerald-600 dark:border-emerald-900 dark:text-emerald-400 dark:hover:border-emerald-600 dark:hover:text-emerald-300"
        >
          + new
        </button>
        <SessionMenu
          sessions={props.sessions}
          sessionId={props.sessionId}
          onSwitchSession={props.onSwitchSession}
          onDeleteSession={props.onDeleteSession}
          onListSessions={props.onListSessions}
        />
        <span
          className={`h-2 w-2 rounded-full ${connected ? "bg-emerald-500" : "bg-red-500"}`}
          title={connected ? "connected" : "disconnected"}
        />
      </div>
    </header>
  );
}
