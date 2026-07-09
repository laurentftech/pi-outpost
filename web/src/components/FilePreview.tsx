import type { OpenFile } from "../useAgent";
import { CopyButton } from "./CopyButton";

/** Read-only file content pane below the file tree. */
export function FilePreview({ file, onClose }: { file: OpenFile; onClose: () => void }) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-zinc-200 px-2 py-1.5 dark:border-zinc-800">
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-zinc-500 dark:text-zinc-400" title={file.path}>
          {file.path}
        </span>
        {file.status === "loaded" && <CopyButton text={file.content} />}
        <button
          type="button"
          onClick={onClose}
          title="Close"
          className="shrink-0 text-xs text-zinc-400 hover:text-zinc-600 dark:text-zinc-600 dark:hover:text-zinc-300"
        >
          ✕
        </button>
      </div>
      <div className="flex-1 overflow-auto p-2">
        {file.status === "loading" && <div className="text-xs text-zinc-400 dark:text-zinc-600">loading…</div>}
        {file.status === "error" && <div className="text-xs text-red-600 dark:text-red-400">{file.message}</div>}
        {file.status === "loaded" && (
          <pre className="whitespace-pre-wrap font-mono text-xs text-zinc-700 dark:text-zinc-300">{file.content}</pre>
        )}
      </div>
    </div>
  );
}
