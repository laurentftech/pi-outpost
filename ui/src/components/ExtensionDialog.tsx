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
const fieldBase =
  "w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-950 dark:focus:border-zinc-500";
const fieldClass = `mb-4 ${fieldBase}`;

/**
 * Placeholder rpiv's RPC walker sends with its multi-select prompt. It is a
 * hardcoded constant on that side (unlike the surrounding prose, which is
 * localized), so it is the one stable signal that an `input` dialog is really
 * a checkbox question flattened into "type the numbers".
 */
const MULTI_SELECT_PLACEHOLDER = "1,3";

/** Separator rpiv puts between an option's label and its description. */
const LABEL_SEPARATOR = " — ";

interface ParsedOption {
  /** 1-based, as printed in the line. */
  index: number;
  label: string;
  description: string;
}

/**
 * Dialog titles arrive as one line of question followed by context the host is
 * expected to lay out itself — option lists, folded-in previews, instructions.
 * A single-line title has no body.
 */
export function splitTitle(title: string): { heading: string; body: string } {
  const cut = title.indexOf("\n");
  if (cut === -1) return { heading: title, body: "" };
  return { heading: title.slice(0, cut), body: title.slice(cut + 1).trim() };
}

/** Parses `"1. Label — description"`; returns null for anything else. */
export function parseOptionLine(line: string): ParsedOption | null {
  const match = /^(\d+)\.\s+(\S[\s\S]*)$/.exec(line.trim());
  if (!match) return null;
  const rest = match[2];
  const sep = rest.indexOf(LABEL_SEPARATOR);
  return {
    index: Number(match[1]),
    label: sep === -1 ? rest : rest.slice(0, sep),
    description: sep === -1 ? "" : rest.slice(sep + LABEL_SEPARATOR.length),
  };
}

/**
 * Recognizes the multi-select question rpiv folds into a free-text `input`.
 * Bails out unless the body really holds a 1..n option list, so an unrelated
 * extension that happens to prefill "1,3" still gets a plain text field.
 */
export function parseMultiSelect(request: DialogRequest): { heading: string; options: ParsedOption[] } | null {
  if (request.method !== "input" || request.placeholder !== MULTI_SELECT_PLACEHOLDER) return null;
  const { heading, body } = splitTitle(request.title);
  const options: ParsedOption[] = [];
  for (const line of body.split("\n")) {
    const option = parseOptionLine(line);
    if (option) options.push(option);
  }
  if (options.length < 2) return null;
  if (options.some((option, i) => option.index !== i + 1)) return null;
  return { heading, options };
}

/** Modal for extension "Custom UI" dialogs (select/confirm/input/editor) — see extensions.md#custom-ui. */
export function ExtensionDialog({ request, onRespond }: ExtensionDialogProps) {
  const [text, setText] = useState(request.method === "editor" ? (request.prefill ?? "") : "");
  const [checked, setChecked] = useState<number[]>([]);
  const hasTimeout = (request.method === "select" || request.method === "confirm" || request.method === "input") && request.timeout;
  const [remaining, setRemaining] = useState<number | null>(hasTimeout ? Math.ceil(hasTimeout / 1000) : null);

  const multiSelect = parseMultiSelect(request);
  const { heading, body } = splitTitle(request.title);

  function cancel() {
    onRespond({ id: request.id, cancelled: true });
  }

  function toggle(index: number) {
    setChecked((current) => (current.includes(index) ? current.filter((i) => i !== index) : [...current, index].sort((a, b) => a - b)));
  }

  /** A typed answer wins: rpiv reads any non-index token as the custom answer. */
  function submitMultiSelect() {
    const typed = text.trim();
    onRespond({ id: request.id, value: typed.length > 0 ? typed : checked.join(",") });
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
        className={`w-full ${body ? "max-w-2xl" : "max-w-md"} rounded-xl border border-zinc-200 bg-white p-4 shadow-2xl dark:border-zinc-700 dark:bg-zinc-900`}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100">{heading}</h2>

        {/* Option lists and previews the walker folded into the title: the host lays them out. */}
        {body && !multiSelect && (
          <pre className="mb-3 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md bg-zinc-50 p-2 font-mono text-xs text-zinc-600 dark:bg-zinc-950 dark:text-zinc-400">
            {body}
          </pre>
        )}

        {request.method === "select" && (
          <div className="mb-1 flex flex-col gap-1">
            {request.options.map((option) => {
              const parsed = parseOptionLine(option);
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => onRespond({ id: request.id, value: option })}
                  className={`text-left ${buttonBase}`}
                >
                  {parsed ? (
                    <>
                      <span className="font-medium text-zinc-900 dark:text-zinc-100">{parsed.label}</span>
                      {parsed.description && (
                        <span className="mt-0.5 block text-xs text-zinc-500 dark:text-zinc-400">{parsed.description}</span>
                      )}
                    </>
                  ) : (
                    option
                  )}
                </button>
              );
            })}
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

        {multiSelect && (
          <>
            <div className="mb-3 flex flex-col gap-1">
              {multiSelect.options.map((option) => (
                <label
                  key={option.index}
                  className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  <input
                    type="checkbox"
                    checked={checked.includes(option.index)}
                    onChange={() => toggle(option.index)}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="font-medium text-zinc-900 dark:text-zinc-100">{option.label}</span>
                    {option.description && (
                      <span className="mt-0.5 block text-xs text-zinc-500 dark:text-zinc-400">{option.description}</span>
                    )}
                  </span>
                </label>
              ))}
            </div>
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="…or type your own answer"
              onKeyDown={(e) => {
                if (e.key === "Enter") submitMultiSelect();
                if (e.key === "Escape") cancel();
              }}
              className={`mb-1 ${fieldBase}`}
            />
            <p className="mb-4 text-xs text-zinc-400 dark:text-zinc-600">A typed answer replaces the selection above.</p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={cancel} className={buttonBase}>
                Cancel
              </button>
              <button type="button" onClick={submitMultiSelect} className={primaryButton}>
                OK
              </button>
            </div>
          </>
        )}

        {request.method === "input" && !multiSelect && (
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
