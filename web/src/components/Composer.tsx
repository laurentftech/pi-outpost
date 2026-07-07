import { useState } from "react";

interface ComposerProps {
  isStreaming: boolean;
  connected: boolean;
  onSend: (text: string) => void;
  onAbort: () => void;
}

export function Composer({ isStreaming, connected, onSend, onAbort }: ComposerProps) {
  const [text, setText] = useState("");

  function submit() {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setText("");
  }

  return (
    <div className="flex items-end gap-2 rounded-xl border border-zinc-800 bg-zinc-900 p-2 focus-within:border-zinc-600">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
        placeholder={
          !connected
            ? "connecting…"
            : isStreaming
              ? "steer the agent… (Enter to send)"
              : "message pi… (Enter to send, Shift+Enter for newline)"
        }
        disabled={!connected}
        rows={Math.min(6, Math.max(1, text.split("\n").length))}
        className="flex-1 resize-none bg-transparent px-2 py-1.5 text-[15px] outline-none placeholder:text-zinc-600 disabled:opacity-50"
      />
      {isStreaming && (
        <button
          type="button"
          onClick={onAbort}
          className="rounded-lg bg-red-900/60 px-3 py-1.5 text-sm text-red-200 hover:bg-red-900"
        >
          stop
        </button>
      )}
      <button
        type="button"
        onClick={submit}
        disabled={!connected || !text.trim()}
        className="rounded-lg bg-zinc-100 px-3 py-1.5 text-sm font-medium text-zinc-900 hover:bg-white disabled:opacity-30"
      >
        {isStreaming ? "steer" : "send"}
      </button>
    </div>
  );
}
