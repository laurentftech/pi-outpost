/**
 * The extension poster-agent-hooks.mts loads (poster-insert task 1.1): does pi let an
 * extension (1) replace what `read` returns for a file and (2) rewrite the `content` of a
 * `write` and the `edits` of an `edit` before the tool runs? A stand-in for the real hiding:
 * every `data:image/png;base64,…` URL is shown as `poster-picture:1`, and put back on writes.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

const PICTURE = /data:image\/png;base64,[A-Za-z0-9+/=]+/g;
const MARKER = /poster-picture:1/g;

export default function (pi) {
  const pictureOf = (file) => readFileSync(file, "utf8").match(PICTURE)?.[0];
  const absolute = (ctx, given) => path.resolve(ctx?.cwd ?? process.cwd(), given);

  pi.on("tool_result", (event, ctx) => {
    if (event.toolName !== "read" || !String(event.input.path).endsWith(".poster.html")) return undefined;
    const text = readFileSync(absolute(ctx, String(event.input.path)), "utf8").replace(PICTURE, "poster-picture:1");
    return { content: [{ type: "text", text }], isError: false };
  });

  pi.on("tool_call", (event, ctx) => {
    if (!String(event.input.path ?? "").endsWith(".poster.html")) return undefined;
    const file = absolute(ctx, String(event.input.path));
    const picture = pictureOf(file);
    if (!picture) return undefined;
    if (event.toolName === "write") event.input.content = String(event.input.content).replace(MARKER, picture);
    if (event.toolName === "edit") {
      for (const edit of event.input.edits) {
        edit.oldText = edit.oldText.replace(MARKER, picture);
        edit.newText = edit.newText.replace(MARKER, picture);
      }
    }
    return undefined;
  });
}
