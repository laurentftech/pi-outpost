import { useEffect, useRef, useState } from "react";
import {
  type ModelChoice,
  type SessionSummary,
  THINKING_LEVELS,
  type ThinkingLevel,
} from "@pi-interface/shared";

interface HeaderProps {
  title?: string;
  model: string;
  models: ModelChoice[];
  thinkingLevel: string;
  modelSupportsReasoning: boolean;
  sessions: SessionSummary[] | null;
  sessionId: string;
  isStreaming: boolean;
  connected: boolean;
  onSetModel: (provider: string, id: string) => void;
  onSetThinking: (level: ThinkingLevel) => void;
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
        className="rounded-md border border-zinc-800 px-2 py-1 text-xs text-zinc-400 hover:border-zinc-600 hover:text-zinc-200"
      >
        sessions
      </button>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-1 max-h-96 w-96 overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl">
          {sessions === null && <div className="px-3 py-2 text-xs text-zinc-500">loading…</div>}
          {sessions?.length === 0 && <div className="px-3 py-2 text-xs text-zinc-500">no saved sessions</div>}
          {sessions?.map((session) => (
            <div
              key={session.path}
              className={`group flex items-start gap-1 hover:bg-zinc-800 ${
                session.id === sessionId ? "bg-zinc-800/60" : ""
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
                <div className="truncate text-zinc-300">
                  {session.name || session.firstMessage || "(empty)"}
                </div>
                <div className="mt-0.5 text-xs text-zinc-600">
                  {new Date(session.modified).toLocaleString()} · {session.messageCount} messages
                  {session.id === sessionId ? " · current" : ""}
                </div>
              </button>
              {session.id !== sessionId && (
                <button
                  type="button"
                  onClick={() => onDeleteSession(session.path)}
                  title="delete session"
                  className="mr-2 mt-2 rounded px-1.5 py-0.5 text-xs text-zinc-600 opacity-0 hover:bg-red-950/60 hover:text-red-400 group-hover:opacity-100"
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

export function Header(props: HeaderProps) {
  const { model, models, thinkingLevel, modelSupportsReasoning, isStreaming, connected } = props;

  return (
    <header className="flex items-center gap-3 border-b border-zinc-800 px-4 py-2.5">
      <span className="text-lg font-semibold tracking-tight" style={{ color: "var(--accent, inherit)" }}>
        {props.title ?? "π"}
      </span>

      <select
        value={model}
        onChange={(e) => {
          const choice = models.find((m) => `${m.provider}/${m.id}` === e.target.value);
          if (choice) props.onSetModel(choice.provider, choice.id);
        }}
        disabled={isStreaming}
        className="max-w-64 rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 font-mono text-xs text-zinc-300 outline-none hover:border-zinc-600 disabled:opacity-50"
      >
        {!models.some((m) => `${m.provider}/${m.id}` === model) && <option value={model}>{model}</option>}
        {models.map((m) => (
          <option key={`${m.provider}/${m.id}`} value={`${m.provider}/${m.id}`}>
            {m.provider}/{m.id}
          </option>
        ))}
      </select>

      {modelSupportsReasoning && (
        <select
          value={thinkingLevel}
          onChange={(e) => props.onSetThinking(e.target.value as ThinkingLevel)}
          disabled={isStreaming}
          className="rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 font-mono text-xs text-zinc-300 outline-none hover:border-zinc-600 disabled:opacity-50"
          title="thinking level"
        >
          {THINKING_LEVELS.map((level) => (
            <option key={level} value={level}>
              think: {level}
            </option>
          ))}
        </select>
      )}

      {isStreaming && (
        <span className="flex items-center gap-1.5 text-xs text-amber-400">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
          working
        </span>
      )}

      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          onClick={props.onNewSession}
          title="new session"
          className="rounded-md border border-emerald-900 px-2 py-1 text-xs text-emerald-400 hover:border-emerald-600 hover:text-emerald-300"
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
