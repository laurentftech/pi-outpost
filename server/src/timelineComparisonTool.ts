/**
 * The tool that compares two plans and presents what moved.
 *
 * Reads a previous and a current timeline from the workspace, pairs their tasks and
 * items by identifier, and presents the compared timeline the reader draws — old
 * positions dashed, new ones solid, shifts written beside them. The comparison is
 * computed in `shared/`, so the agent never computes a slip by hand; it may also be
 * written to a file for a review report. The two plans are only read: the current one
 * stays the pure plan it was.
 *
 * SECURITY: neither input is named `path`, so `scopeToRoot` does not confine them;
 * both are confined here against `allowedRoots`, exactly as the figure tool confines
 * its own. `output_path` goes through `assertWritableDestination`, and is written with
 * `wx` so nothing existing is overwritten.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { Type } from "typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { parseSerializedStructuredExchange } from "@pi-outpost/shared/structured-exchange/parse";
import { checkStructuredExchangeSchema } from "@pi-outpost/shared/structured-exchange/schema-node";
import type { StructuredExchangeLimits } from "@pi-outpost/shared/structured-exchange/bounds";
import {
  STRUCTURED_EXCHANGE_SCHEMA_V3,
  type StructuredTimelineData,
  type ValidatedStructuredExchange,
} from "@pi-outpost/shared/structured-exchange";
import { compareTimelines } from "@pi-outpost/shared/structured-exchange/timeline-comparison";
import { assertWritableDestination } from "./extractionOutput.ts";
import { isWithinAny, realResolve } from "./sandbox.ts";
import { digest } from "./structuredExchangeTool.ts";

export interface TimelineComparisonToolOptions {
  cwd: string;
  allowedRoots: string[];
  maxBytes: number;
  /** Zone `output_path` must land in; `null` refuses every output. */
  writableRoot: string | null;
  limits?: StructuredExchangeLimits;
}

const parameters = Type.Object({
  previous_path: Type.String({ description: "The earlier plan: a structured-exchange timeline file, relative to the workspace root or absolute." }),
  current_path: Type.String({ description: "The current plan, in the same form. It is not modified." }),
  label: Type.Optional(
    Type.String({
      maxLength: 500,
      description: 'How the earlier plan is named in the comparison, e.g. "Plan of 1 September". Defaults to its title, then its file name.',
    }),
  ),
  output_path: Type.Optional(
    Type.String({ description: "Also write the compared timeline to this new .json file, e.g. for a review report. Must not exist." }),
  ),
});

const DESCRIPTION = [
  "Compare two versions of a planning timeline and present what moved: each task and milestone paired by its `id` across the two files, its previous dates kept beside the new ones, what is new marked added and what was dropped kept as removed.",
  "Use it whenever a plan is updated and the change has to be shown or reported — never work out shifts by hand.",
  "Items without an `id` cannot be paired; the result says how many there were, so give every item an `id` in plans that will be compared.",
  "The current plan is not modified. To put the comparison in a report, give `output_path` and draw it with write_structure_figure.",
].join(" ");

async function readTimeline(
  options: TimelineComparisonToolOptions,
  target: string,
): Promise<{ ok: true; data: StructuredTimelineData; name: string } | { ok: false; text: string }> {
  const resolved = await realResolve(path.resolve(options.cwd, target));
  if (!isWithinAny(options.allowedRoots, resolved)) {
    throw new Error(`Access denied: "${target}" is outside the sandbox (${options.allowedRoots[0]})`);
  }
  const stat = await fs.stat(resolved).catch(() => null);
  if (stat === null || !stat.isFile()) throw new Error(`No such file: ${target}`);
  if (stat.size > options.maxBytes) throw new Error(`"${target}" is larger than the document limit`);
  const verdict = parseSerializedStructuredExchange(await fs.readFile(resolved, "utf8"), checkStructuredExchangeSchema, options.limits);
  if (!verdict.valid) {
    const lines = verdict.issues.map((issue) => `- ${issue.rule} at ${issue.path === "" ? "(document)" : issue.path}: ${issue.message}`);
    return { ok: false, text: [`\`${target}\` does not satisfy the structured-exchange contract:`, ...lines].join("\n") };
  }
  if (verdict.envelope.kind !== "timeline") return { ok: false, text: `\`${target}\` is a ${verdict.envelope.kind}, not a timeline.` };
  const data = verdict.envelope.data as StructuredTimelineData;
  // Comparing a comparison would stack two references in one document.
  if (data.comparedTo !== undefined) {
    return { ok: false, text: `\`${target}\` is already a comparison (with "${data.comparedTo.label}"); compare the plans themselves.` };
  }
  return { ok: true, data, name: path.basename(target).replace(/\.json$/i, "") };
}

export function createTimelineComparisonToolDefinition(options: TimelineComparisonToolOptions): ToolDefinition {
  return {
    name: "compare_timelines",
    label: "Compare plans",
    description: DESCRIPTION,
    promptSnippet: "Compare two versions of a planning timeline and present what moved",
    promptGuidelines: [
      "When a plan is updated, present the update with compare_timelines rather than describing the shifts yourself.",
    ],
    parameters,
    async execute(_toolCallId, params) {
      const { previous_path: previousPath, current_path: currentPath, label, output_path: outputPath } = params as {
        previous_path: string;
        current_path: string;
        label?: string;
        output_path?: string;
      };
      const writeTo =
        outputPath === undefined
          ? undefined
          : await (async () => {
              if (!/\.json$/i.test(outputPath)) throw new Error(`Cannot write "${outputPath}": a compared timeline is a .json file.`);
              return assertWritableDestination(outputPath, { cwd: options.cwd, writableRoot: options.writableRoot });
            })();

      const previous = await readTimeline(options, previousPath);
      const current = await readTimeline(options, currentPath);
      const refusals = [previous, current].filter((read): read is { ok: false; text: string } => !read.ok);
      if (refusals.length > 0) {
        return {
          content: [{ type: "text", text: ["Nothing was compared, presented or written.", ...refusals.map((read) => read.text)].join("\n") }],
          details: undefined,
          isError: true,
        };
      }
      const before = previous as { ok: true; data: StructuredTimelineData; name: string };
      const after = current as { ok: true; data: StructuredTimelineData; name: string };
      const comparison = compareTimelines(before.data, after.data, label ?? before.data.title ?? before.name);
      const document = { schema: STRUCTURED_EXCHANGE_SCHEMA_V3, kind: "timeline", data: comparison.data };
      // The comparison is held to the contract like any document: a pairing this tool got
      // wrong must not reach a reader.
      const verdict = parseSerializedStructuredExchange(JSON.stringify(document), checkStructuredExchangeSchema, options.limits);
      if (!verdict.valid) {
        const lines = verdict.issues.map((issue) => `- ${issue.rule} at ${issue.path}: ${issue.message}`);
        return {
          content: [{ type: "text", text: ["The two plans could not be compared into a valid timeline:", ...lines].join("\n") }],
          details: undefined,
          isError: true,
        };
      }
      if (writeTo !== undefined) {
        await fs.mkdir(path.dirname(writeTo), { recursive: true });
        try {
          await fs.writeFile(writeTo, `${JSON.stringify(document, null, 2)}\n`, { flag: "wx" });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "EEXIST") {
            throw new Error(`"${outputPath}" already exists; choose another path.`);
          }
          throw error;
        }
      }
      const { previous: missingBefore, current: missingAfter } = comparison.uncompared;
      const lines = [
        `Compared \`${currentPath}\` with \`${previousPath}\` ("${comparison.data.comparedTo!.label}").`,
        `(${digest(verdict.envelope as ValidatedStructuredExchange)})`,
        missingBefore + missingAfter === 0
          ? undefined
          : `Not compared, for want of an \`id\`: ${missingAfter} item${missingAfter === 1 ? "" : "s"} of the current plan and ${missingBefore} of the previous one. Give every item an \`id\` to compare them.`,
        outputPath === undefined ? undefined : `Written to \`${outputPath}\`; draw it into a report with write_structure_figure.`,
      ].filter((line): line is string => line !== undefined);
      return { content: [{ type: "text", text: lines.join("\n") }], details: verdict.envelope };
    },
  } as ToolDefinition;
}
