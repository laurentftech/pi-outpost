/**
 * A Word or PowerPoint file written by create_document or create_presentation, handed
 * over in the chat.
 *
 * The file travels in the page: the browser has no route to the tool server, and the
 * server keeps nothing. The card says what the file holds — its outline and its
 * figures — so the reader knows what they are downloading before they open it, and
 * the button hands the bytes to the browser the way the table's exports do.
 */
import { save } from "../../ui/src/util/download";

export interface EmbeddedDownload {
  mode: "download";
  fileName: string;
  mediaType: string;
  size: number;
  /** The file, base64. */
  data: string;
  outline: { level: number; text: string }[];
  figures: string[];
  template: string;
}

function bytesOf(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function sizeLabel(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function DownloadCard({ file }: { file: EmbeddedDownload }) {
  const deck = file.fileName.toLowerCase().endsWith(".pptx");
  return (
    <section className="m-1 rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" aria-label={file.fileName}>
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold" data-testid="download-name">
            {file.fileName}
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400">
            {deck ? "PowerPoint" : "Word"} · {sizeLabel(file.size)} · {file.template}
          </div>
        </div>
        <button
          type="button"
          className="rounded-md bg-[var(--accent)] px-3 py-1.5 font-medium text-white hover:opacity-90"
          onClick={() => save(new Blob([bytesOf(file.data) as BlobPart], { type: file.mediaType }), file.fileName)}
        >
          Download
        </button>
      </div>
      {file.outline.length > 0 && (
        <div className="mt-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{deck ? "Slides" : "Outline"}</div>
          <ol className="mt-1 space-y-0.5" data-testid="download-outline">
            {file.outline.map((entry, index) => (
              <li key={index} style={{ paddingLeft: `${(entry.level - 1) * 12}px` }}>
                {entry.text}
              </li>
            ))}
          </ol>
        </div>
      )}
      {file.figures.length > 0 && (
        <div className="mt-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Figures</div>
          <ul className="mt-1 list-disc pl-5" data-testid="download-figures">
            {file.figures.map((figure, index) => (
              <li key={index}>{figure}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
