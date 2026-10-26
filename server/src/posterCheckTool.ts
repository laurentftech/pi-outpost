/**
 * The tool that checks a poster the agent has written (poster-files:
 * TheAgentChecksThePostersItWrites), the twin of drawio_check.
 *
 * The agent writes `.poster.html` with its ordinary file tools and cannot see it drawn. This
 * reads the file and says what the editor would refuse, leave undrawn or remove (errors) and
 * what would read badly (warnings), each with what to write instead; then opens what its frames
 * name — a diagram and its page, a picture file — as the editor will. It writes nothing.
 *
 * SECURITY: `path` is named exactly that so `scopeToRoot` in sandbox.ts confines it like
 * every other file tool, and the resolved path is checked against the read zone here too. So is
 * every file a frame names: one outside the zone is refused unopened, as the editor's read would be.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { Type } from "typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { checkPosterText, type PosterFrame, type PosterIssue } from "@pi-outpost/posters/check";
import { MAX_PICTURE_FILE_BYTES } from "@pi-outpost/posters/diagrams";
import { MAX_POSTER_BYTES, POSTER_SUFFIX } from "@pi-outpost/posters/format";
import { DrawioReadError, readDrawio } from "./drawio.ts";
import { DRAWIO_MAX_BYTES } from "./drawioTool.ts";
import { isWithinAny, realResolve } from "./sandbox.ts";

export interface PosterCheckToolOptions {
  /** Paths the model gives are resolved against this, and a frame's path starting with `/` too. */
  cwd: string;
  /** Zones the resolved paths must land in (root plus any read exceptions). */
  allowedRoots: string[];
}

const parameters = Type.Object({
  path: Type.String({ description: "Path to the .poster.html file, relative to the workspace root or absolute." }),
});

const DESCRIPTION = [
  "Check a poster (.poster.html) you have written, since you cannot see it drawn.",
  "Reports errors — a page the editor will not open (missing poster-format meta, <style data-poster> or <div class=\"poster-page\">), pictures or backgrounds pointing at a file or the web (never drawn: a poster fetches nothing), what the editor removes, frames naming a draw.io diagram, page or picture file that cannot be used — and warnings: text inside an SVG drawing, oversized drawings, a page size that is not the format's.",
  "Run it after every write or edit of a .poster.html file, and fix what it reports before handing the poster over.",
].join(" ");

const MAX_LISTED_ISSUES = 40;

const refused = (text: string) => ({ content: [{ type: "text" as const, text }], details: undefined, isError: true });

/** The poster's frame's file, or the issue that keeps the editor from filling the frame with it. */
async function frameIssue(frame: PosterFrame, poster: string, options: PosterCheckToolOptions): Promise<string | undefined> {
  const named = frame.name === undefined ? `a frame naming "${frame.path}"` : `the frame "${frame.name}" (${frame.path})`;
  const target = frame.path.startsWith("/") ? path.join(options.cwd, frame.path) : path.resolve(path.dirname(poster), frame.path);
  const resolved = await realResolve(target);
  if (!isWithinAny(options.allowedRoots, resolved)) return `${named} names a file outside the workspace, which the editor cannot read.`;
  const stat = await fs.stat(resolved).catch(() => null);
  const from = frame.path.startsWith("/") ? "from the workspace root" : "from the poster's directory";
  if (stat === null || !stat.isFile()) return `${named}: no such file ${from}. Write the path ${from}, or from the root starting with /.`;
  if (frame.kind === "picture") {
    return stat.size > MAX_PICTURE_FILE_BYTES ? `${named}: the picture is ${Math.round(stat.size / 1024 / 1024)} MB, above the ${MAX_PICTURE_FILE_BYTES / 1024 / 1024} MB the editor reads.` : undefined;
  }
  if (stat.size > DRAWIO_MAX_BYTES) return `${named}: the diagram is larger than the ${DRAWIO_MAX_BYTES / 1024 / 1024} MB a diagram may be.`;
  let pages;
  try {
    pages = readDrawio(await fs.readFile(resolved, "utf8"));
  } catch (error) {
    if (error instanceof DrawioReadError) return `${named}: draw.io cannot open it: ${error.message}. Run drawio_check on it.`;
    throw error;
  }
  if (frame.page === undefined) return undefined;
  // A page by its name, or its number from 1, as the editor finds it (ui/src/util/drawioPages.ts).
  // An unnamed page is "Page-N" here and "Page N" in the editor.
  const names = pages.map((page) => page.name);
  const number = /^\d+$/.test(frame.page) ? Number(frame.page) : 0;
  const unnamed = /^Page (\d+)$/.exec(frame.page)?.[1];
  if (names.includes(frame.page) || (number >= 1 && number <= pages.length) || (unnamed !== undefined && names[Number(unnamed) - 1] === `Page-${unnamed}`)) return undefined;
  return `${named}: the diagram has no page "${frame.page}"; its pages are ${names.map((name) => `"${name}"`).join(", ")} (or their numbers from 1).`;
}

/** The report as the agent reads it: the verdict first, then what to fix. */
function describe(target: string, format: string | undefined, frames: PosterFrame[], issues: PosterIssue[]): string {
  const errors = issues.filter((issue) => issue.severity === "error");
  const warnings = issues.filter((issue) => issue.severity === "warning");
  const filledOnOpen = frames.filter((frame) => !frame.filled);
  const summary = [
    format === undefined ? undefined : `format ${format}`,
    filledOnOpen.length === 0 ? undefined : `${filledOnOpen.length} frame${filledOnOpen.length === 1 ? "" : "s"} the editor fills when the poster opens (${filledOnOpen.map((frame) => `${frame.kind === "drawio" ? "diagram" : "picture"} ${frame.path}${frame.page === undefined ? "" : ` page ${frame.page}`}`).join(", ")})`,
  ].filter(Boolean).join("; ");
  if (issues.length === 0) {
    return `\`${target}\` is a valid poster with no defect found${summary ? `: ${summary}` : ""}.${filledOnOpen.length > 0 ? " Tell the person to open it and save it to keep the pictures." : ""}`;
  }
  const lines = [
    errors.length > 0
      ? `\`${target}\` would not give the person what you meant: ${errors.length} error${errors.length === 1 ? "" : "s"} and ${warnings.length} warning${warnings.length === 1 ? "" : "s"}.${summary ? ` ${summary}.` : ""}`
      : `\`${target}\` opens, but ${warnings.length} warning${warnings.length === 1 ? "" : "s"} would make it read badly.${summary ? ` ${summary}.` : ""}`,
  ];
  const listed = [...errors, ...warnings].slice(0, MAX_LISTED_ISSUES);
  for (const issue of listed) lines.push(`- ${issue.severity}: ${issue.message}`);
  if (issues.length > listed.length) lines.push(`- … and ${issues.length - listed.length} more`);
  lines.push(errors.length > 0 ? "Fix the errors, then run poster_check again." : "Fix what you can, then run poster_check again.");
  return lines.join("\n");
}

export function createPosterCheckToolDefinition(options: PosterCheckToolOptions): ToolDefinition {
  return {
    name: "poster_check",
    label: "Poster check",
    description: DESCRIPTION,
    promptSnippet: "Check a .poster.html poster for what the editor refuses or will not draw",
    promptGuidelines: [
      "After every write or edit of a .poster.html file, run poster_check and fix what it reports before saying the poster is done.",
    ],
    parameters,
    async execute(_toolCallId, params) {
      const { path: target } = params as { path: string };
      if (!target.toLowerCase().endsWith(POSTER_SUFFIX)) return refused(`"${target}" is not a poster: give a ${POSTER_SUFFIX} file.`);
      const resolved = await realResolve(path.resolve(options.cwd, target));
      if (!isWithinAny(options.allowedRoots, resolved)) {
        throw new Error(`Access denied: "${target}" is outside the sandbox (${options.allowedRoots[0]})`);
      }
      const stat = await fs.stat(resolved).catch(() => null);
      if (stat === null || !stat.isFile()) return refused(`No such file: ${target}`);
      if (stat.size > MAX_POSTER_BYTES + 64 * 1024) return refused(`"${target}" is larger than a poster may be.`);

      const { format, frames, issues } = checkPosterText(await fs.readFile(resolved, "utf8"));
      for (const frame of frames) {
        // A filled frame is left as it is when the poster opens: what it names no longer matters.
        if (frame.filled) continue;
        const issue = await frameIssue(frame, resolved, options);
        if (issue !== undefined) issues.push({ severity: "error", message: issue });
      }
      return { content: [{ type: "text", text: describe(target, format, frames, issues) }], details: undefined };
    },
  };
}
