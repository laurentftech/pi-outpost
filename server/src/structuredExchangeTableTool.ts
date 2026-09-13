/**
 * The tool that writes a structured-exchange table into the workspace as Markdown.
 *
 * The reader can already take a table away as Markdown from the rendering. This is
 * the same act, available to the agent, so a specification it is writing can carry
 * the table itself — and be taken on to Word like any Markdown — instead of a
 * hand-copied version of it that drifts from the data.
 *
 * Deliberately basic: a document in, a new `.md` file out, in every project. It is not
 * a second exporter — the Markdown is the shared table export, the text the reader
 * downloads and the reference validator writes — and it is not a way to write files:
 * one `.md` at a path inside the writable zone, never over an existing file.
 *
 * SECURITY: `path` is named exactly that so `scopeToRoot` in sandbox.ts confines it like
 * every other file tool. `output_path` is a second path argument with no confinement of
 * its own — `assertWritableDestination` keeps it inside the writable zone, exactly as for
 * the figure tool and the document extractors.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { Type } from "typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { parseSerializedStructuredExchange } from "@pi-outpost/shared/structured-exchange/parse";
import { checkStructuredExchangeSchema } from "@pi-outpost/shared/structured-exchange/schema-node";
import { holdToProfile } from "@pi-outpost/shared/structured-exchange/profile-check";
import { tableMarkdown } from "@pi-outpost/shared/structured-exchange/table-export";
import type { StructuredExchangeLimits } from "@pi-outpost/shared/structured-exchange/bounds";
import { readTableRow, type StructuredTableData } from "@pi-outpost/shared/structured-exchange";
import { assertWritableDestination } from "./extractionOutput.ts";
import { isWithinAny, realResolve } from "./sandbox.ts";
import { describeUnusableProfiles, readProjectProfiles } from "./structuredExchangeProfiles.ts";

export interface StructuredExchangeTableToolOptions {
  /** Paths the model gives are resolved against this. */
  cwd: string;
  /** The project whose profile registry applies — not `cwd`, which under a sandbox is the sandbox root. */
  projectRoot: string;
  /** Zones the resolved document path must land in (root plus any read exceptions). */
  allowedRoots: string[];
  /** Largest document this tool will open, in bytes. */
  maxBytes: number;
  /** Zone `output_path` must land in. `null` means writing is disabled. */
  writableRoot: string | null;
  /** Deployment limits, at or below the schema's ceilings. */
  limits?: StructuredExchangeLimits;
}

const parameters = Type.Object({
  path: Type.String({
    description: "Path to the structured-exchange table document (the JSON file), relative to the workspace root or absolute.",
  }),
  output_path: Type.String({
    description: "Where to write the Markdown. Must end in .md, and must not already exist.",
  }),
});

const DESCRIPTION = [
  "Write a structured-exchange table to a new Markdown (.md) file in the workspace: each chapter becomes a heading and its rows a Markdown table under the declared columns.",
  "Use it to put a table into a document you are writing, or to hand a table on as a file; the Markdown is the same as the reader's \"download Markdown\", and can be exported to Word like any Markdown.",
  "Only a table: draw a graph or a sequence with write_structure_figure.",
].join(" ");

/** A limit is only actionable if it reads like one. */
function describeSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${Math.round(bytes / (1024 * 1024))} MB` : `${Math.round(bytes / 1024)} KB`;
}

const refused = (text: string) => ({ content: [{ type: "text" as const, text }], details: undefined, isError: true });

export function createStructuredExchangeTableToolDefinition(options: StructuredExchangeTableToolOptions): ToolDefinition {
  return {
    name: "write_structure_table",
    label: "Table",
    description: DESCRIPTION,
    promptSnippet: "Write a structured-exchange table as a Markdown file",
    promptGuidelines: [
      "When a document you are writing should include a structured-exchange table, write it with write_structure_table rather than retyping the rows.",
    ],
    parameters,
    async execute(_toolCallId, params) {
      const { path: target, output_path: destination } = params as { path: string; output_path: string };

      // SECURITY: two arguments, two zones. The read zone never grants a write.
      const resolved = await realResolve(path.resolve(options.cwd, target));
      if (!isWithinAny(options.allowedRoots, resolved)) {
        throw new Error(`Access denied: "${target}" is outside the sandbox (${options.allowedRoots[0]})`);
      }
      if (!/\.md$/i.test(destination)) {
        throw new Error(`Cannot write "${destination}": a table is written as Markdown and must be named .md.`);
      }
      const writeTo = await assertWritableDestination(destination, { cwd: options.cwd, writableRoot: options.writableRoot });

      const stat = await fs.stat(resolved).catch(() => null);
      if (stat === null || !stat.isFile()) throw new Error(`No such file: ${target}`);
      if (stat.size > options.maxBytes) {
        throw new Error(`"${target}" is larger than the ${describeSize(options.maxBytes)} document limit`);
      }

      const verdict = parseSerializedStructuredExchange(await fs.readFile(resolved, "utf8"), checkStructuredExchangeSchema, options.limits);
      if (!verdict.valid) {
        const lines = verdict.issues.map((issue) => `- ${issue.rule} at ${issue.path === "" ? "(document)" : issue.path}: ${issue.message}`);
        return refused([`No table was written. \`${target}\` does not satisfy the structured-exchange contract:`, ...lines].join("\n"));
      }
      if (verdict.envelope.kind !== "table") {
        return refused(
          `No table was written. \`${target}\` is a ${verdict.envelope.kind}, not a table; draw it with write_structure_figure instead.`,
        );
      }

      // Held to the project's profile and rules exactly as presenting it would be: a file
      // written here is a way for the document to leave, and must not be one a refusal
      // would have stopped.
      const project = await readProjectProfiles(options.projectRoot);
      if (project.state === "unusable") {
        return refused(
          [
            "No table was written. This project's structured-exchange profile registry cannot be used, so no document can be checked against it:",
            ...describeUnusableProfiles(project.issues),
          ].join("\n"),
        );
      }
      if (project.state === "usable") {
        const held = holdToProfile(verdict.envelope, project.context);
        if (held.outcome === "refused") {
          const against = held.profile === undefined ? "this project's profile rules" : `this project's profile "${held.profile}"`;
          return refused(
            [
              `No table was written. \`${target}\` strays from ${against}:`,
              ...held.issues.map((issue) => `- ${issue.rule} at ${issue.path === "" ? "(document)" : issue.path}: ${issue.message}`),
            ].join("\n"),
          );
        }
      }

      const data = verdict.envelope.data as StructuredTableData;
      const markdown = tableMarkdown(data);
      // The folder is made rather than demanded, as for figures: a sandboxed agent has
      // no mkdir, and the destination's confinement has already been checked.
      await fs.mkdir(path.dirname(writeTo), { recursive: true });
      try {
        await fs.writeFile(writeTo, markdown, { flag: "wx" });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") {
          throw new Error(`"${destination}" already exists; a table is written to a new file only. Choose another path.`);
        }
        throw new Error(`Cannot write "${destination}": ${(error as Error).message}`);
      }

      const rows = data.rows.filter((row) => readTableRow(row).heading === undefined).length;
      const chapters = data.rows.length - rows;
      return {
        content: [
          {
            type: "text",
            text: [
              `Wrote \`${destination}\` (${Buffer.byteLength(markdown, "utf8")} bytes): ${rows} row${rows === 1 ? "" : "s"}${chapters === 0 ? "" : ` in ${chapters} chapter${chapters === 1 ? "" : "s"}`}.`,
              `Include it in a Markdown document by copying its content, or link it as \`[${path.basename(destination, ".md")}](${destination})\`.`,
            ].join("\n"),
          },
        ],
        details: undefined,
      };
    },
  } as ToolDefinition;
}
