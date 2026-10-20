/**
 * "pi-outpost was updated" — what changed since the version that ran before, read from
 * the changelog the server carries, so it needs no network.
 *
 * Collapsed to one line until asked: an update is good news, not a dialog to get past.
 * Dismissing it is remembered per version in this browser, like the update notice; the
 * server keeps offering it for as long as the updated version runs, so every browser
 * that has not seen it yet still does.
 */
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { OutpostChanges } from "@pi-outpost/shared";

const DISMISSED_KEY = "pi-outpost:changes-notice-dismissed";

function dismissedVersion(): string | null {
  try {
    return window.localStorage.getItem(DISMISSED_KEY);
  } catch {
    return null;
  }
}

/** A changelog link leaves the app for GitHub; it must not replace it. */
function ExternalLink(props: React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  return <a {...props} target="_blank" rel="noreferrer" />;
}

export function ChangesNotice({ changes }: { changes: OutpostChanges }) {
  const [dismissed, setDismissed] = useState(() => dismissedVersion());
  const [open, setOpen] = useState(false);
  if (dismissed === changes.to) return null;
  const hasEntries = changes.entries.length > 0;
  return (
    <div
      role="status"
      data-testid="changes-notice"
      className="border-b border-emerald-200 bg-emerald-50 text-xs text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100"
    >
      <div className="flex items-center gap-2 px-4 py-1.5">
        <span className="min-w-0 flex-1">
          pi-outpost was updated to {changes.to} (from {changes.from}).
        </span>
        {hasEntries ? (
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
            className="shrink-0 rounded px-1.5 font-medium text-emerald-800 underline-offset-2 hover:underline dark:text-emerald-300"
          >
            {open ? "Hide what changed" : "What's changed"}
          </button>
        ) : (
          <ExternalLink href={changes.releaseNotes} className="shrink-0 font-medium text-emerald-800 underline-offset-2 hover:underline dark:text-emerald-300">
            Release notes
          </ExternalLink>
        )}
        <button
          type="button"
          aria-label="Dismiss the update news"
          onClick={() => {
            try {
              window.localStorage.setItem(DISMISSED_KEY, changes.to);
            } catch {
              // Storage refused: the news goes for now and comes back next time.
            }
            setDismissed(changes.to);
          }}
          className="shrink-0 rounded px-1.5 text-emerald-700 hover:bg-emerald-100 dark:text-emerald-300 dark:hover:bg-emerald-900/50"
        >
          ×
        </button>
      </div>
      {open && hasEntries && (
        <div data-testid="changes-notice-body" className="max-h-[50vh] overflow-y-auto border-t border-emerald-200 px-4 py-2 dark:border-emerald-900">
          {changes.entries.map((entry) => (
            <section key={entry.version} className="mb-3 last:mb-0">
              <h2 className="text-sm font-semibold">
                {entry.version}
                {entry.date && <span className="ml-2 font-normal text-emerald-700 dark:text-emerald-400">{entry.date}</span>}
              </h2>
              <div className="prose-chat text-emerald-950 dark:text-emerald-100">
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ExternalLink }}>
                  {entry.markdown}
                </ReactMarkdown>
              </div>
            </section>
          ))}
          <ExternalLink href={changes.releaseNotes} className="font-medium text-emerald-800 underline-offset-2 hover:underline dark:text-emerald-300">
            Release notes on GitHub
          </ExternalLink>
        </div>
      )}
    </div>
  );
}
