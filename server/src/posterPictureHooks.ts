/**
 * Keeps the pictures in a `.poster.html` file out of what the agent reads, and puts them back in
 * what it writes (poster-elements: TheModelSeesMarkersNotPictureData, MarkersAreRestoredOnWrite).
 *
 * The person puts pictures into a poster in the editor, which embeds each as a data URL of a few
 * hundred kB on one line. pi's `read` cannot show a line longer than 50 kB, so the agent could not
 * read such a poster at all; and an agent rewriting it could never copy the pictures back. Through
 * pi's extension events, without a tool of its own:
 *
 * - a `read` of a poster that holds pictures answers the file read again with each picture as a
 *   marker, `poster-picture:N`, cut to the call's offset and limit as `read` itself cuts;
 * - a `write` or an `edit` of a poster has its markers turned back into the pictures of the file
 *   on disk before the tool runs; a marker naming no picture blocks the call, saying so.
 *
 * Only a read the tool itself allowed is rewritten: a refused one (outside the sandbox, a missing
 * file) keeps its refusal. `bash` reading the file is not covered; the posters skill says to use
 * `read`. Loaded in the embedded runtime and, through piOutpostTools.ts, in an RPC child.
 */
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DEFAULT_MAX_BYTES, formatSize, truncateHead, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { POSTER_SUFFIX, PosterRefusal } from "@pi-outpost/posters/format";
import { hidePictures, restorePictures } from "@pi-outpost/posters/markers";

const isPosterPath = (given: unknown): given is string => typeof given === "string" && given.toLowerCase().endsWith(POSTER_SUFFIX);

/** The file a tool's `path` names, as pi's tools resolve it: an `@` mention, `~`, or relative to the session's directory. */
function resolved(cwd: string, given: string): string {
  const named = given.startsWith("@") ? given.slice(1) : given;
  const home = named === "~" || named.startsWith("~/") ? path.join(os.homedir(), named.slice(1)) : named;
  return path.resolve(cwd, home);
}

/** The pictures in the poster file, in marker order; none when it has none or cannot be read. */
async function picturesOf(file: string): Promise<string[]> {
  const text = await readFile(file, "utf8").catch(() => undefined);
  return text === undefined ? [] : hidePictures(text, "").pictures;
}

/** What `read` answers for `text` with the call's offset and limit, as the tool words it. */
function readAnswer(text: string, shownPath: string, offset?: number, limit?: number): string {
  const lines = text.split("\n");
  const start = offset ? Math.max(0, offset - 1) : 0;
  if (start >= lines.length) return `Offset ${offset} is beyond end of file (${lines.length} lines total)`;
  const end = limit !== undefined ? Math.min(start + limit, lines.length) : lines.length;
  const truncation = truncateHead(lines.slice(start, end).join("\n"));
  const first = start + 1;
  if (truncation.firstLineExceedsLimit) {
    return `[Line ${first} is ${formatSize(Buffer.byteLength(lines[start]!, "utf8"))}, exceeds ${formatSize(DEFAULT_MAX_BYTES)} limit. Use bash: sed -n '${first}p' ${shownPath} | head -c ${DEFAULT_MAX_BYTES}]`;
  }
  if (truncation.truncated) {
    const last = first + truncation.outputLines - 1;
    const why = truncation.truncatedBy === "lines" ? "" : ` (${formatSize(DEFAULT_MAX_BYTES)} limit)`;
    return `${truncation.content}\n\n[Showing lines ${first}-${last} of ${lines.length}${why}. Use offset=${last + 1} to continue.]`;
  }
  if (end < lines.length) return `${truncation.content}\n\n[${lines.length - end} more lines in file. Use offset=${end + 1} to continue.]`;
  return truncation.content;
}

export function registerPosterPictureHooks(pi: ExtensionAPI): void {
  pi.on("tool_result", async (event, ctx) => {
    if (event.toolName !== "read" || event.isError || !isPosterPath(event.input.path)) return undefined;
    const text = await readFile(resolved(ctx.cwd, event.input.path), "utf8").catch(() => undefined);
    if (text === undefined) return undefined;
    const hidden = hidePictures(text, "");
    if (hidden.pictures.length === 0) return undefined;
    const { offset, limit } = event.input as { offset?: number; limit?: number };
    return { content: [{ type: "text", text: readAnswer(hidden.html, event.input.path, offset, limit) }] };
  });

  pi.on("tool_call", async (event, ctx) => {
    if ((event.toolName !== "write" && event.toolName !== "edit") || !isPosterPath(event.input.path)) return undefined;
    const pictures = await picturesOf(resolved(ctx.cwd, event.input.path));
    try {
      if (event.toolName === "write") {
        const input = event.input as { content: string };
        input.content = restorePictures(input.content, "", pictures).html;
      } else {
        for (const edit of (event.input as { edits: Array<{ oldText: string; newText: string }> }).edits) {
          edit.oldText = restorePictures(edit.oldText, "", pictures).html;
          edit.newText = restorePictures(edit.newText, "", pictures).html;
        }
      }
    } catch (error) {
      if (error instanceof PosterRefusal) return { block: true, reason: `Not written: ${error.message}.` };
      throw error;
    }
    return undefined;
  });
}
