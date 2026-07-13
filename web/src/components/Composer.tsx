import { useEffect, useMemo, useRef, useState } from "react";
import type { CommandInfo, FileSearchEntry, WireImage } from "@pi-outpost/shared";
import { composePrompt, mentionedPaths, type Attachment } from "../attachments";
import type { FileSearch } from "../useAgent";

interface ComposerProps {
  isStreaming: boolean;
  connected: boolean;
  commands: CommandInfo[];
  fileSearch: FileSearch | null;
  /** Extension set_editor_text() request (see extensions.md#custom-ui) — bump nonce to reapply the same text. */
  prefill: { text: string; nonce: number } | null;
  attachments: Attachment[];
  onAttach: (files: Iterable<File>) => void;
  /** Paths the draft names with `@`; the file tree marks them as referenced. */
  onMentionPaths: (paths: string[]) => void;
  onRemoveAttachment: (index: number) => void;
  onSend: (text: string, images?: WireImage[]) => void;
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
  attachments,
  onAttach,
  onMentionPaths,
  onRemoveAttachment,
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
  const fileInputRef = useRef<HTMLInputElement>(null);
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

  const mentioned = useMemo(() => mentionedPaths(text), [text]);
  useEffect(() => {
    onMentionPaths(mentioned);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mentioned.join("\n")]);

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
    const full = composePrompt(text, attachments);
    const images = attachments
      .filter((a) => a.kind === "image")
      .map((a) => ({ data: a.data, mimeType: a.mimeType }));
    // A path reference is context, not a question: opening a preview must not turn a
    // stray Enter into a prompt. Content the user supplied (a dropped file, an image)
    // still stands on its own.
    const onlyReferences = attachments.every((a) => a.kind === "path");
    if (!text.trim() && (onlyReferences || !full) && images.length === 0) return;
    onSend(full, images.length > 0 ? images : undefined);
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

  function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(e.clipboardData.files);
    if (files.length > 0) {
      e.preventDefault();
      onAttach(files);
    }
  }

  return (
    <div className="relative">
      {attachments.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {attachments.map((attachment, i) => (
            <span
              key={`${attachment.name}:${i}`}
              title={attachment.kind === "path" ? `${attachment.name} — sent as a reference; the agent reads the file itself` : attachment.name}
              className="flex items-center gap-1.5 rounded-md border border-zinc-200 bg-zinc-50 py-1 pl-1.5 pr-1 text-xs text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-300"
            >
              {attachment.kind === "image" ? (
                <img
                  src={`data:${attachment.mimeType};base64,${attachment.data}`}
                  alt={attachment.name}
                  className="h-8 w-8 rounded object-cover"
                />
              ) : (
                <span aria-hidden className={attachment.kind === "path" ? "font-mono font-bold text-blue-600 dark:text-blue-400" : ""}>
                  {attachment.kind === "path" ? "@" : "📄"}
                </span>
              )}
              <span className="max-w-40 truncate">{attachment.name}</span>
              <button
                type="button"
                onClick={() => onRemoveAttachment(i)}
                title="remove attachment"
                className="rounded px-1 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-700 dark:hover:bg-zinc-700 dark:hover:text-zinc-200"
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}
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
          onPaste={handlePaste}
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
            title="stop"
            aria-label="Stop the agent"
            className="rounded-lg bg-red-100 p-2 text-red-700 hover:bg-red-200 dark:bg-red-900/60 dark:text-red-200 dark:hover:bg-red-900"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className="h-4 w-4">
              <rect x="6" y="6" width="12" height="12" rx="2" />
            </svg>
          </button>
        )}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={!connected}
          title="attach files"
          aria-label="Attach files"
          className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-200 hover:text-zinc-700 disabled:opacity-30 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden className="h-4 w-4">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"
            />
          </svg>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files?.length) onAttach(Array.from(e.target.files));
            e.target.value = "";
          }}
        />
        <button
          type="button"
          onClick={submit}
          disabled={!connected || (!text.trim() && attachments.length === 0)}
          title={isStreaming ? "steer" : "send"}
          aria-label={isStreaming ? "Steer the agent" : "Send message"}
          className="rounded-lg bg-zinc-900 p-2 text-zinc-100 hover:bg-zinc-800 disabled:opacity-30 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
        >
          {isStreaming ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden className="h-4 w-4">
              <circle cx="6" cy="19" r="3" />
              <path strokeLinecap="round" d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15" />
              <circle cx="18" cy="5" r="3" />
            </svg>
          ) : (
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.8}
              aria-hidden
              className="h-4 w-4"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 12 3.27 3.13c6.6 1.9 12.83 4.9 18.43 8.87-5.6 3.97-11.83 6.97-18.43 8.87L6 12Zm0 0h7.5"
              />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}
