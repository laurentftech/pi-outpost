/**
 * The file writes the agent has in flight, so a check of a file waits for them.
 *
 * A model can send `edit` and `drawio_check` on the same file in one message. The runtime
 * prepares every call of a message in order, then runs them together, so the check could
 * read the file before the edit lands and report on a file that no longer exists. It
 * answered "no defect" that way while the edit made two new ones (drawio-wire-anchors,
 * live Codestral run). A write is registered when its call starts and released when it
 * ends, success or not; a check waits for the writes to its file first.
 */
import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const WRITING_TOOLS = new Set(["write", "edit"]);
/** A write that never reports its end does not hold a check forever. */
export const PENDING_WRITE_TIMEOUT_MS = 30_000;

/**
 * One spelling per file, links resolved: the write and the check can name a file through
 * different paths to it (on macOS the temporary directory is under /var, a link to
 * /private/var), and a check that missed its write that way reported on the old file. The
 * file, or folders above it, may not exist yet — a write can be creating them — so the
 * nearest existing ancestor is resolved and the rest kept as given.
 */
function canonical(file: string): string {
  const absolute = path.resolve(file);
  const rest: string[] = [];
  let at = absolute;
  while (!existsSync(at)) {
    const parent = path.dirname(at);
    if (parent === at) return absolute;
    rest.unshift(path.basename(at));
    at = parent;
  }
  try {
    return path.join(realpathSync.native(at), ...rest);
  } catch {
    return absolute;
  }
}

const inFlight = new Map<string, { file: string; done: Promise<void>; release: () => void }>();

/** Registers a write to `file` (absolute) under the tool call that makes it. */
export function writeStarted(toolCallId: string, file: string): void {
  let release = () => {};
  const done = new Promise<void>((resolve) => (release = resolve));
  inFlight.set(toolCallId, { file: canonical(file), done, release });
}

/** Releases the write made by this tool call, if it was one. */
export function writeEnded(toolCallId: string): void {
  inFlight.get(toolCallId)?.release();
  inFlight.delete(toolCallId);
}

/** Resolves once no write to `file` (absolute) is in flight, or after the timeout. */
export async function writesSettled(file: string, timeoutMs = PENDING_WRITE_TIMEOUT_MS): Promise<void> {
  const target = canonical(file);
  const pending = [...inFlight.values()].filter((write) => write.file === target).map((write) => write.done);
  if (pending.length === 0) return;
  let timer: NodeJS.Timeout | undefined;
  await Promise.race([Promise.all(pending), new Promise<void>((resolve) => (timer = setTimeout(resolve, timeoutMs)))]);
  clearTimeout(timer);
}

export function registerPendingWriteHooks(pi: ExtensionAPI): void {
  pi.on("tool_execution_start", (event, ctx) => {
    const target = (event.args as { path?: unknown } | undefined)?.path;
    if (WRITING_TOOLS.has(event.toolName) && typeof target === "string") writeStarted(event.toolCallId, path.resolve(ctx.cwd, target));
  });
  pi.on("tool_execution_end", (event) => writeEnded(event.toolCallId));
}
