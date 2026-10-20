/**
 * The tool that checks a draw.io diagram the agent has written.
 *
 * The agent writes `.drawio` XML with its ordinary file tools; it cannot look at the
 * result without draw.io itself. This reads the file and says what would make it open
 * wrong (errors) or read badly (warnings), naming the cells, so the agent can fix them
 * before handing the diagram over. It writes nothing.
 *
 * SECURITY: `path` is named exactly that so `scopeToRoot` in sandbox.ts confines it like
 * every other file tool, and the resolved path is checked against the read zone here too.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { Type } from "typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { checkDrawio, describeDrawioReport, DrawioReadError } from "./drawio.ts";
import { isWithinAny, realResolve } from "./sandbox.ts";

/** Largest diagram this tool opens. draw.io files are text; a bigger one is not a diagram anyone reads. */
export const DRAWIO_MAX_BYTES = 16 * 1024 * 1024;

export interface DrawioToolOptions {
  /** Paths the model gives are resolved against this. */
  cwd: string;
  /** Zones the resolved path must land in (root plus any read exceptions). */
  allowedRoots: string[];
  /** Largest file this tool will open, in bytes. */
  maxBytes?: number;
}

const parameters = Type.Object({
  path: Type.String({ description: "Path to the .drawio file, relative to the workspace root or absolute." }),
});

const DESCRIPTION = [
  "Check a draw.io diagram (.drawio) you have written, since you cannot see it rendered.",
  "Reports errors draw.io would refuse or mis-draw — XML it cannot read, duplicate ids, cells whose parent or connector ends do not exist, connectors attached to nothing, shapes with no usable size — and warnings a reader would trip on: shapes partly overlapping, shapes outside their container.",
  "Reads plain and compressed pages. Run it after every write or edit of a .drawio file, and fix what it reports before handing the diagram over.",
].join(" ");

const refused = (text: string) => ({ content: [{ type: "text" as const, text }], details: undefined, isError: true });

export function createDrawioCheckToolDefinition(options: DrawioToolOptions): ToolDefinition {
  const maxBytes = options.maxBytes ?? DRAWIO_MAX_BYTES;
  return {
    name: "drawio_check",
    label: "draw.io check",
    description: DESCRIPTION,
    promptSnippet: "Check a .drawio diagram for errors and layout problems",
    promptGuidelines: [
      "When the user wants a diagram they can open or edit in draw.io, write it as a .drawio file and check it with drawio_check; the interface draws it in the file viewer.",
      "After every write or edit of a .drawio file, run drawio_check and fix what it reports before saying the diagram is done.",
      "Once drawio_check reports no error, show the diagram in your reply as a picture of the file — ![name](./path/to/file.drawio) — where the conversation draws it.",
    ],
    parameters,
    async execute(_toolCallId, params) {
      const { path: target } = params as { path: string };
      const resolved = await realResolve(path.resolve(options.cwd, target));
      if (!isWithinAny(options.allowedRoots, resolved)) {
        throw new Error(`Access denied: "${target}" is outside the sandbox (${options.allowedRoots[0]})`);
      }
      const stat = await fs.stat(resolved).catch(() => null);
      if (stat === null || !stat.isFile()) return refused(`No such file: ${target}`);
      if (stat.size > maxBytes) return refused(`"${target}" is larger than the ${Math.round(maxBytes / (1024 * 1024))} MB a diagram may be`);

      const text = await fs.readFile(resolved, "utf8");
      try {
        const report = checkDrawio(text);
        return { content: [{ type: "text", text: describeDrawioReport(target, report) }], details: undefined };
      } catch (error) {
        if (error instanceof DrawioReadError) return refused(`\`${target}\` cannot be opened by draw.io: ${error.message}.`);
        throw error;
      }
    },
  };
}
