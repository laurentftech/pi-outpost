/**
 * The tool that shows the agent the pictures in a poster (poster-elements:
 * TheAgentCanLookAtAPostersPictures), the pi-outpost twin of the Claude extension's
 * `get_poster` with `see_pictures`.
 *
 * The agent reads a `.poster.html` with `read`, which shows each picture the person put in as
 * a marker (posterPictureHooks.ts): a marker and its frame's name say nothing of what the
 * picture shows. Asked, this answers each picture as an image, announced by its marker, so a
 * model that sees images can tell what a frame really holds. A model that does not is told so
 * rather than sent pictures it cannot use. It writes nothing.
 *
 * SECURITY: `path` is named exactly that so `scopeToRoot` in sandbox.ts confines it like
 * every other file tool, and the resolved path is checked against the read zone here too.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { Type } from "typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { MAX_POSTER_BYTES, POSTER_SUFFIX } from "@pi-outpost/posters/format";
import { MAX_SEEN_PICTURES, hidePictures, pictureKind, seeablePicture } from "@pi-outpost/posters/markers";
import { isWithinAny, realResolve } from "./sandbox.ts";

export interface PosterPicturesToolOptions {
  /** Paths the model gives are resolved against this. */
  cwd: string;
  /** Zones the resolved path must land in (root plus any read exceptions). */
  allowedRoots: string[];
}

const parameters = Type.Object({
  path: Type.String({ description: "Path to the .poster.html file, relative to the workspace root or absolute." }),
  pictures: Type.Optional(Type.Array(Type.Integer({ minimum: 1 }), { description: "The markers' numbers to look at (2 for poster-picture:2); every picture, up to eight, when omitted." })),
});

const DESCRIPTION = [
  "Look at the pictures in a poster (.poster.html).",
  "Reading a poster shows each picture the user put in as a marker, poster-picture:N, and neither the marker nor its frame's name tells you what the picture shows.",
  "Call this before describing, captioning, choosing or moving a picture: it answers each picture as an image after its marker.",
].join(" ");

type Content = Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }>;

const answer = (content: Content, isError = false) => ({ content, details: undefined, ...(isError ? { isError: true } : {}) });

export function createPosterPicturesToolDefinition(options: PosterPicturesToolOptions): ToolDefinition {
  return {
    name: "poster_pictures",
    label: "Poster pictures",
    description: DESCRIPTION,
    promptSnippet: "Look at the pictures in a .poster.html poster",
    promptGuidelines: [
      "A poster's pictures read as markers (poster-picture:N): call poster_pictures to see what they show before describing, captioning or moving one, rather than guessing from the frame's name.",
    ],
    parameters,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const { path: target, pictures: wanted } = params as { path: string; pictures?: number[] };
      if (!target.toLowerCase().endsWith(POSTER_SUFFIX)) return answer([{ type: "text", text: `"${target}" is not a poster: give a ${POSTER_SUFFIX} file.` }], true);
      const resolved = await realResolve(path.resolve(options.cwd, target));
      if (!isWithinAny(options.allowedRoots, resolved)) {
        throw new Error(`Access denied: "${target}" is outside the sandbox (${options.allowedRoots[0]})`);
      }
      const stat = await fs.stat(resolved).catch(() => null);
      if (stat === null || !stat.isFile()) return answer([{ type: "text", text: `No such file: ${target}` }], true);
      if (stat.size > MAX_POSTER_BYTES + 64 * 1024) return answer([{ type: "text", text: `"${target}" is larger than a poster may be.` }], true);
      const { pictures } = hidePictures(await fs.readFile(resolved, "utf8"), "");
      if (pictures.length === 0) return answer([{ type: "text", text: `"${target}" holds no picture: its frames, if any, are empty.` }]);
      if (ctx?.model && !ctx.model.input.includes("image")) {
        return answer([{ type: "text", text: `"${target}" holds ${pictures.length} picture(s), but the model in use (${ctx.model.id}) does not take images, so they cannot be shown. Do not guess what they show from their frames' names; ask the user.` }], true);
      }
      const numbers = (wanted?.length ? wanted : pictures.map((_picture, index) => index + 1)).slice(0, MAX_SEEN_PICTURES);
      const content: Content = [{ type: "text", text: `"${target}" holds ${pictures.length} picture(s); shown here: ${numbers.map((n) => `poster-picture:${n}`).join(", ")}.` }];
      for (const n of numbers) {
        const picture = pictures[n - 1];
        if (picture === undefined) {
          content.push({ type: "text", text: `poster-picture:${n} names no picture of this poster (it has poster-picture:1 to poster-picture:${pictures.length}).` });
          continue;
        }
        const seeable = seeablePicture(picture);
        if (!seeable) {
          content.push({ type: "text", text: `poster-picture:${n} is not a photo or drawing to look at (${pictureKind(picture)}).` });
          continue;
        }
        content.push({ type: "text", text: `poster-picture:${n}:` }, { type: "image", ...seeable });
      }
      const unseen = (wanted?.length ? wanted.length : pictures.length) - numbers.length;
      if (unseen > 0) content.push({ type: "text", text: `${unseen} more picture(s) not shown: ask for them by number.` });
      return answer(content);
    },
  };
}
