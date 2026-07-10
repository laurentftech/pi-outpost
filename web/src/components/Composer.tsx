import { useEffect, useMemo, useRef, useState } from "react";
import type { CommandInfo, FileSearchEntry } from "@pi-outpost/shared";
import type { FileSearch } from "../useAgent";

interface ComposerProps {
  isStreaming: boolean;
  connected: boolean;
  commands: CommandInfo[];
  fileSearch: FileSearch | null;
  /** Extension set_editor_text() request (see extensions.md#custom-ui) — bump nonce to reapply the same text. */
  prefill: { text: string; nonce: number } | null;
  onSend: (text: string) => void;
  onAbort: () => void;
  onSearchFiles: (query: string) => void;
  onClearFileSearch: () => void;
}

const SOURCE_BADGE: Record<CommandInfo["source"], string> = {
  extension: "ext",
  prompt: "prompt",
  skill: "skill",
};

function isDirType(type: FileSearchEntry["type"]): boolean {
  return type === "directory" || type === "symlink-directory";
}

/** A `@` mention being typed at the cursor: "@" preceded by start-of-text or whitespace, no space since. */
function findMention(text: string, cursor: number): { start: number; query: string } | null {
  const upToCursor = text.slice(0, cursor);
  const match = /(?:^|\s)@([^\s@]*)$/.exec(upToCursor);
  if (!match) return null;
  return { start: cursor - match[1].length - 1, query: match[1] };
}

export function Composer({
  isStreaming,
  connected,
  commands,
  fileSearch,
  prefill,
  onSend,
  onAbort,
  onSearchFiles,
  onClearFileSearch,
}: ComposerProps) {
  const [text, setText] = useState("");
  const [cursor, setCursor] = useState(0);
  const [selected, setSelected] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pendingCursorRef = useRef<number | null>(null);

  useEffect(() => {
    if (prefill) setText(prefill.text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill?.nonce]);

  useEffect(() => {
    if (pendingCursorRef.current === null) return;
    // A mouse-picked suggestion unmounts (menu closes), taking focus with it — reclaim it
    // so the caret lands where we set it and typing/Escape keep reaching the textarea.
    textareaRef.current?.focus();
    textareaRef.current?.setSelectionRange(pendingCursorRef.current, pendingCursorRef.current);
    pendingCursorRef.current = null;
  }, [text]);

  // Autocomplete only while typing the command name: "/" + no whitespace yet
  const commandPrefix = useMemo(() => {
    const match = /^\/(\S*)$/.exec(text);
    return match ? match[1].toLowerCase() : null;
  }, [text]);

  const commandSuggestions = useMemo(() => {
    if (commandPrefix === null) return [];
    return commands.filter((c) => c.name.toLowerCase().startsWith(commandPrefix)).slice(0, 12);
  }, [commandPrefix, commands]);

  const mention = commandPrefix === null ? findMention(text, cursor) : null;

  // Debounce the search request; drop it once the mention is gone or empty.
  useEffect(() => {
    if (!mention || mention.query.length === 0) {
      onClearFileSearch();
      return;
    }
    const handle = window.setTimeout(() => onSearchFiles(mention.query), 150);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mention?.query]);

  const fileSuggestions = mention && fileSearch?.query === mention.query ? fileSearch.results : [];

  const menu = useMemo(() => {
    if (commandSuggestions.length > 0) return { kind: "command" as const, items: commandSuggestions };
    if (mention && fileSuggestions.length > 0) return { kind: "file" as const, items: fileSuggestions };
    return null;
  }, [commandSuggestions, mention, fileSuggestions]);

  const open = menu !== null && !dismissed;

  // Re-open (and reset the selection) whenever the trigger text changes
  const menuKey = commandPrefix !== null ? `cmd:${commandPrefix}` : mention ? `file:${mention.query}` : null;
  useEffect(() => {
    setSelected(0);
    setDismissed(false);
  }, [menuKey]);
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
    onClearFileSearch();
  }

  function pick(command: CommandInfo) {
    const next = `/${command.name} `;
    setText(next);
    pendingCursorRef.current = next.length;
    setCursor(next.length);
  }

  function pickFile(entry: FileSearchEntry) {
    if (!mention) return;
    const before = text.slice(0, mention.start);
    const after = text.slice(cursor);
    const inserted = `@${entry.path}${isDirType(entry.type) ? "/" : " "}`;
    const next = `${before}${inserted}${after}`;
    setText(next);
    onClearFileSearch();
    const newCursor = before.length + inserted.length;
    pendingCursorRef.current = newCursor;
    setCursor(newCursor);
  }

  function pickSelected() {
    if (!menu) return;
    if (menu.kind === "command") {
      const command = menu.items[selected];
      if (command) pick(command);
    } else {
      const entry = menu.items[selected];
      if (entry) pickFile(entry);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (open && menu) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelected((s) => (s + 1) % menu.items.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelected((s) => (s - 1 + menu.items.length) % menu.items.length);
        return;
      }
      if (e.key === "Tab" || e.key === "Enter") {
        e.preventDefault();
        pickSelected();
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

  function syncCursor(e: React.SyntheticEvent<HTMLTextAreaElement>) {
    setCursor(e.currentTarget.selectionStart ?? 0);
  }

  return (
    <div className="relative">
      {open && menu && (
        <div
          ref={listRef}
          className="absolute bottom-full left-0 z-20 mb-2 max-h-72 w-full max-w-xl overflow-y-auto rounded-lg border border-zinc-200 bg-white py-1 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
        >
          {menu.kind === "command"
            ? menu.items.map((command, i) => (
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
              ))
            : menu.items.map((entry, i) => (
                <button
                  key={entry.path}
                  type="button"
                  data-selected={i === selected}
                  onMouseEnter={() => setSelected(i)}
                  onClick={() => pickFile(entry)}
                  className={`flex w-full items-baseline gap-2 px-3 py-1.5 text-left text-sm ${
                    i === selected ? "bg-zinc-100 dark:bg-zinc-800" : ""
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate font-mono text-zinc-800 dark:text-zinc-200">
                    {entry.path}
                    {isDirType(entry.type) ? "/" : ""}
                  </span>
                </button>
              ))}
        </div>
      )}

      <div className="flex items-end gap-2 rounded-xl border border-zinc-200 bg-zinc-50 p-2 focus-within:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:focus-within:border-zinc-600">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setCursor(e.target.selectionStart ?? e.target.value.length);
          }}
          onKeyDown={handleKeyDown}
          onClick={syncCursor}
          onKeyUp={syncCursor}
          placeholder={
            !connected
              ? "connecting…"
              : isStreaming
                ? "steer the agent… (Enter to send)"
                : "message pi… (/ for commands, @ for files, Enter to send, Shift+Enter for newline)"
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
