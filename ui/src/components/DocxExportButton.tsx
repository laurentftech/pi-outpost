import { useRef, useState } from "react";

/**
 * The affordance that takes a document away as Word.
 *
 * The writer, KaTeX and mermaid are large and none of them is loaded until this is
 * pressed: the import is inside the handler, so a session that never exports never
 * fetches a document writer. This mirrors how the workbook export in
 * `tableExport.ts` earns its own chunk.
 *
 * Independent of the writable zone — this produces a download, not a workspace
 * write — so a read-only file offers it exactly as a writable one does.
 */
export function DocxExportButton({
  text,
  path,
  serverUrl,
  token,
  template,
}: {
  text: string;
  path: string;
  serverUrl?: string;
  token?: string | null;
  /** The configured Word template's name: offered as a second export when present. */
  template?: string;
}) {
  const [state, setState] = useState<"idle" | "working" | "failed">("idle");
  /** Which of the two exports the state describes, so a failure is shown where it happened. */
  const [which, setWhich] = useState<"plain" | "template">("plain");
  const [reason, setReason] = useState<string | null>(null);
  /**
   * A second press that belongs to the same intention is ignored.
   *
   * Two guards, because one is not enough. The in-flight flag stops a press
   * landing while a long export is still running — two of those race for
   * mermaid's global configuration. But a short document exports in a few
   * milliseconds, so the two halves of an ordinary double-click both complete and
   * the reader finds two identical files in their downloads folder. People
   * double-click buttons; the second half of one is not a second request.
   *
   * Refs rather than state: both have to be true immediately, and state does not
   * settle until the next render — which is far too late to stop the next click.
   *
   * The window is per button. Pressing the other export straight after one finished
   * is a second intention, not the tail of a double-click: a template export can come
   * back in a couple of hundred milliseconds, and a guard shared by both buttons
   * silently swallowed the plain export pressed right after it.
   */
  const busy = useRef(false);
  const lastStarted = useRef<Record<"plain" | "template", number>>({ plain: 0, template: 0 });

  /** Long enough to swallow a double-click, short enough to be invisible. */
  const SAME_INTENTION_MS = 750;

  async function exportDocx(kind: "plain" | "template") {
    if (busy.current || Date.now() - lastStarted.current[kind] < SAME_INTENTION_MS) return;
    busy.current = true;
    lastStarted.current[kind] = Date.now();
    setWhich(kind);
    setState("working");
    setReason(null);
    try {
      const { downloadDocx, downloadDocxInTemplate } = await import("../export/docxExport");
      // The origin and token the viewer reads this file through: the export
      // fetches the pictures the document references the same way.
      await (kind === "template" ? downloadDocxInTemplate : downloadDocx)(text, path, { serverUrl, token });
      setState("idle");
    } catch (cause) {
      // Said out loud rather than swallowed: a download that silently does nothing
      // looks exactly like one the browser is still preparing.
      setState("failed");
      setReason(cause instanceof Error ? cause.message : String(cause));
    } finally {
      busy.current = false;
    }
  }

  const className =
    "shrink-0 rounded px-1.5 py-0.5 text-xs text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 disabled:opacity-50 dark:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300";
  const label = (kind: "plain" | "template", idle: string) =>
    state === "working" && which === kind ? "… exporting" : state === "failed" && which === kind ? "⚠ export failed" : idle;
  const title = (kind: "plain" | "template", idle: string) => (state === "failed" && which === kind ? `Could not export: ${reason ?? "unknown reason"}` : idle);

  return (
    <>
      <button
        type="button"
        onClick={() => void exportDocx("plain")}
        disabled={state === "working"}
        title={title("plain", "Download as a Word document")}
        aria-label="Download as a Word document"
        className={className}
      >
        {label("plain", "⤓ word")}
      </button>
      {template !== undefined && (
        // The export without a template stays beside it: a template that cannot be
        // used reports why here, and never takes the plain export down with it.
        <button
          type="button"
          onClick={() => void exportDocx("template")}
          disabled={state === "working"}
          title={title("template", `Download as a Word document in the template ${template}`)}
          aria-label={`Download as a Word document in the template ${template}`}
          className={className}
        >
          {label("template", "⤓ word · template")}
        </button>
      )}
    </>
  );
}
