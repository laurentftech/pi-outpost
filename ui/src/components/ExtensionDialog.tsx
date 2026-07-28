import { useEffect, useState } from "react";
import type { DialogRequest } from "../useAgent";

type DialogResponse = { id: string; value: string } | { id: string; confirmed: boolean } | { id: string; cancelled: true };

interface ExtensionDialogProps {
  request: DialogRequest;
  onRespond: (response: DialogResponse) => void;
}

const buttonBase =
  "rounded-md border px-3 py-1.5 text-sm border-zinc-200 hover:bg-zinc-100 dark:border-zinc-800 dark:hover:bg-zinc-800";
const primaryButton =
  "rounded-md bg-zinc-900 px-3 py-1.5 text-sm text-zinc-100 hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white";
const fieldClass =
  "mb-4 w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-950 dark:focus:border-zinc-500";

/** Modal for extension "Custom UI" dialogs (select/confirm/input/editor) — see extensions.md#custom-ui. */
export function ExtensionDialog({ request, onRespond }: ExtensionDialogProps) {
  const [text, setText] = useState(request.method === "editor" ? (request.prefill ?? "") : "");
  const hasTimeout = (request.method === "select" || request.method === "confirm" || request.method === "input") && request.timeout;
  const [remaining, setRemaining] = useState<number | null>(hasTimeout ? Math.ceil(hasTimeout / 1000) : null);

  function cancel() {
    onRespond({ id: request.id, cancelled: true });
  }

  useEffect(() => {
    if (remaining === null) return;
    if (remaining <= 0) {
      onRespond({ id: request.id, cancelled: true });
      return;
    }
    const timer = setTimeout(() => setRemaining((r) => (r === null ? null : r - 1)), 1000);
    return () => clearTimeout(timer);
  }, [remaining, request.id, onRespond]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={cancel}>
      <div
        className="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-4 shadow-2xl dark:border-zinc-700 dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100">{request.title}</h2>

        {request.method === "select" && (
          <div className="mb-1 flex flex-col gap-1">
            {request.options.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => onRespond({ id: request.id, value: option })}
                className={`text-left ${buttonBase}`}
              >
                {option}
              </button>
            ))}
          </div>
        )}

        {request.method === "confirm" && (
          <>
            <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-400">{request.message}</p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => onRespond({ id: request.id, confirmed: false })} className={buttonBase}>
                No
              </button>
              <button type="button" onClick={() => onRespond({ id: request.id, confirmed: true })} className={primaryButton}>
                Yes
              </button>
            </div>
          </>
        )}

        {request.method === "input" && (
          <>
            <input
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={request.placeholder}
              onKeyDown={(e) => {
                if (e.key === "Enter") onRespond({ id: request.id, value: text });
                if (e.key === "Escape") cancel();
              }}
              className={fieldClass}
            />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={cancel} className={buttonBase}>
                Cancel
              </button>
              <button type="button" onClick={() => onRespond({ id: request.id, value: text })} className={primaryButton}>
                OK
              </button>
            </div>
          </>
        )}

        {request.method === "editor" && (
          <>
            <textarea
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={8}
              onKeyDown={(e) => {
                if (e.key === "Escape") cancel();
              }}
              className={`resize-none font-mono ${fieldClass}`}
            />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={cancel} className={buttonBase}>
                Cancel
              </button>
              <button type="button" onClick={() => onRespond({ id: request.id, value: text })} className={primaryButton}>
                OK
              </button>
            </div>
          </>
        )}

        {remaining !== null && (
          <p className="mt-3 text-right text-xs text-zinc-400 dark:text-zinc-600">auto-dismiss in {remaining}s</p>
        )}
      </div>
    </div>
  );
}
