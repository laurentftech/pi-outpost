import { useEffect, useMemo, useRef, useState } from "react";
import type { CommandInfo } from "@pi-interface/shared";

interface ComposerProps {
  isStreaming: boolean;
  connected: boolean;
  commands: CommandInfo[];
  onSend: (text: string) => void;
  onAbort: () => void;
}

const SOURCE_BADGE: Record<CommandInfo["source"], string> = {
  extension: "ext",
  prompt: "prompt",
  skill: "skill",
};

export function Composer({ isStreaming, connected, commands, onSend, onAbort }: ComposerProps) {
  const [text, setText] = useState("");
  const [selected, setSelected] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  // Autocomplete only while typing the command name: "/" + no whitespace yet
  const commandPrefix = useMemo(() => {
    const match = /^\/(\S*)$/.exec(text);
    return match ? match[1].toLowerCase() : null;
  }, [text]);

  const suggestions = useMemo(() => {
    if (commandPrefix === null) return [];
    return commands.filter((c) => c.name.toLowerCase().startsWith(commandPrefix)).slice(0, 12);
  }, [commandPrefix, commands]);

  const open = suggestions.length > 0 && !dismissed;

  useEffect(() => {
    setSelected(0);
    setDismissed(false);
  }, [commandPrefix]);
  useEffect(() => {
    listRef.current
      ?.querySelector('[data-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  function submit() {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setText("");
  }

  function pick(command: CommandInfo) {
    setText(`/${command.name} `);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (open) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelected((s) => (s + 1) % suggestions.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelected((s) => (s - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (e.key === "Tab" || e.key === "Enter") {
        e.preventDefault();
        // suggestions can shrink under the cursor (commands refresh mid-typing)
        const command = suggestions[selected];
        if (command) pick(command);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setDismissed(true);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <div className="relative">
      {open && (
        <div
          ref={listRef}
          className="absolute bottom-full left-0 z-20 mb-2 max-h-72 w-full max-w-xl overflow-y-auto rounded-lg border border-zinc-200 bg-white py-1 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
        >
          {suggestions.map((command, i) => (
            <button
              key={command.name}
              type="button"
              data-selected={i === selected}
              onMouseEnter={() => setSelected(i)}
              onClick={() => pick(command)}
              className={`flex w-full items-baseline gap-2 px-3 py-1.5 text-left text-sm ${
                i === selected ? "bg-zinc-100 dark:bg-zinc-800" : ""
              }`}
            >
              <span className="font-mono text-zinc-800 dark:text-zinc-200">/{command.name}</span>
              {command.argumentHint && (
                <span className="font-mono text-xs text-zinc-500">{command.argumentHint}</span>
              )}
              {command.description && (
                <span className="min-w-0 flex-1 truncate text-xs text-zinc-500">{command.description}</span>
              )}
              <span className="ml-auto shrink-0 rounded bg-zinc-200 px-1 text-[10px] uppercase text-zinc-500 dark:bg-zinc-800">
                {SOURCE_BADGE[command.source]}
              </span>
            </button>
          ))}
        </div>
      )}

      <div className="flex items-end gap-2 rounded-xl border border-zinc-200 bg-zinc-50 p-2 focus-within:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:focus-within:border-zinc-600">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            !connected
              ? "connecting…"
              : isStreaming
                ? "steer the agent… (Enter to send)"
                : "message pi… (/ for commands, Enter to send, Shift+Enter for newline)"
          }
          disabled={!connected}
          rows={Math.min(6, Math.max(1, text.split("\n").length))}
          className="flex-1 resize-none bg-transparent px-2 py-1.5 text-[15px] outline-none placeholder:text-zinc-400 disabled:opacity-50 dark:placeholder:text-zinc-600"
        />
        {isStreaming && (
          <button
            type="button"
            onClick={onAbort}
            className="rounded-lg bg-red-100 px-3 py-1.5 text-sm text-red-700 hover:bg-red-200 dark:bg-red-900/60 dark:text-red-200 dark:hover:bg-red-900"
          >
            stop
          </button>
        )}
        <button
          type="button"
          onClick={submit}
          disabled={!connected || !text.trim()}
          className="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-zinc-100 hover:bg-zinc-800 disabled:opacity-30 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
        >
          {isStreaming ? "steer" : "send"}
        </button>
      </div>
    </div>
  );
}
