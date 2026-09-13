/**
 * The tool that turns a structured-exchange document into a picture on disk.
 *
 * The reader can already do this by hand: narrow a diagram by kind in the
 * interface, press download, and insert the file into a document. This is the same
 * act, available to the agent, so that a report it writes can carry the figures it
 * is talking about instead of describing them.
 *
 * Two things it is deliberately not. It is not a second renderer — the picture is
 * computed by the same code the browser draws from, so a figure in a report and
 * the diagram it came from cannot disagree. And it is not a way to write files: it
 * writes one `.svg` at a path inside the writable zone and nothing else, through
 * the same confinement every other agent write goes through.
 *
 * SECURITY: `path` is named exactly that so `scopeToRoot` in sandbox.ts confines
 * it like every other file tool. `output_path` is a *second* path argument and
 * arrives with no confinement at all — `assertWritableDestination` is what keeps
 * it inside the writable zone, exactly as for the document extractors.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { Type } from "typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import {
  describeCoverage,
  describeFigureRefusal,
  figureForDocument,
} from "@pi-outpost/shared/structured-exchange/export";
import { checkStructuredExchangeSchema } from "@pi-outpost/shared/structured-exchange/schema-node";
import { parseSerializedStructuredExchange } from "@pi-outpost/shared/structured-exchange/parse";
import { holdToProfile } from "@pi-outpost/shared/structured-exchange/profile-check";
import type { StructuredExchangeLimits } from "@pi-outpost/shared/structured-exchange/bounds";
import { assertWritableDestination } from "./extractionOutput.ts";
import { isWithinAny, realResolve } from "./sandbox.ts";
import { describeUnusableProfiles, readProjectProfiles } from "./structuredExchangeProfiles.ts";

export interface StructuredExchangeFigureToolOptions {
  /** Paths the model gives are resolved against this. */
  cwd: string;
  /**
   * The project whose profile registry applies — not `cwd`, which under a sandbox is
   * the sandbox root inside the project. Required, so no construction site can leave
   * a figure unchecked by omission.
   */
  projectRoot: string;
  /** Zones the resolved document path must land in (root plus any read exceptions). */
  allowedRoots: string[];
  /** Largest document this tool will open, in bytes. */
  maxBytes: number;
  /**
   * Zone `output_path` must land in. `null` means writing is disabled, and every
   * destination is refused — the sandbox is read-only.
   */
  writableRoot: string | null;
  /** Deployment limits, at or below the schema's ceilings. */
  limits?: StructuredExchangeLimits;
}

const parameters = Type.Object({
  path: Type.String({
    description: "Path to the structured-exchange document (the JSON file), relative to the workspace root or absolute.",
  }),
  output_path: Type.String({
    description: "Where to write the figure. Must end in .svg, and must not already exist.",
  }),
  hide_element_kinds: Type.Optional(
    Type.Array(Type.String(), {
      description:
        'Element `kind` values to leave out, e.g. ["infrastructure"]. This is the element vocabulary only: a relationship of the same name is unaffected. Omit to draw every element.',
    }),
  ),
  hide_relationship_kinds: Type.Optional(
    Type.Array(Type.String(), {
      description:
        'Relationship `kind` values to leave out, e.g. ["signal"]. This is the relationship vocabulary only: an element of the same name is unaffected. Omit to draw every relationship.',
    }),
  ),
  viewpoint: Type.Optional(
    Type.String({
      description:
        'The `id` of a viewpoint the document declares, e.g. "power". The figure shows what that viewpoint retains and states its concern inside the drawing; the hide lists still apply on top. Refused, listing the declared ones, when the document does not declare it.',
    }),
  ),
});

const DESCRIPTION = [
  "Write a figure of a structured-exchange document to an .svg file, so a Markdown document you are writing can show the diagram rather than describe it.",
  "Reference it from Markdown as a relative path — `![Power train](figures/power.svg)` — and the interface renders it in the preview.",
  "The two hide lists are separate vocabularies: hide_element_kinds hides boxes by their `kind`, hide_relationship_kinds hides arrows by theirs, and the same name in both means two different things. Omit them to draw the whole document.",
  "Write one figure per view worth having rather than one figure of everything: a narrowed figure is the reason this takes narrowing at all.",
  "When the document declares viewpoints, name one with `viewpoint` instead of rebuilding its selection from hide lists: the figure then states which viewpoint it shows and the concern it frames, so a report can carry one figure per viewpoint.",
  "A relationship whose endpoint is hidden goes with it — an arrow to a box that is not drawn cannot be drawn.",
  "A table has no figure; export it as a spreadsheet instead.",
].join(" ");

/** A limit is only actionable if it reads like one: "4 MB", not "0 MB". */
function describeSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${Math.round(bytes / (1024 * 1024))} MB` : `${Math.round(bytes / 1024)} KB`;
}

export function createStructuredExchangeFigureToolDefinition(
  options: StructuredExchangeFigureToolOptions,
): ToolDefinition {
  return {
    name: "write_structure_figure",
    label: "Figure",
    description: DESCRIPTION,
    promptSnippet: "Write a diagram of a structured-exchange document as an .svg file",
    promptGuidelines: [
      "When a document you are writing should show a diagram, write the figure with write_structure_figure and reference the .svg from the Markdown — do not hand-draw diagram syntax.",
      "Narrow each figure to the view it is making: hide the kinds that are not what this figure is about, rather than exporting the whole document repeatedly.",
    ],
    parameters,
    async execute(_toolCallId, params) {
      const {
        path: target,
        output_path: destination,
        hide_element_kinds: hiddenElementKinds,
        hide_relationship_kinds: hiddenRelationshipKinds,
        viewpoint,
      } = params as {
        path: string;
        output_path: string;
        hide_element_kinds?: string[];
        hide_relationship_kinds?: string[];
        viewpoint?: string;
      };

      // SECURITY: two arguments, two zones. The read zone never grants a write.
      const resolved = await realResolve(path.resolve(options.cwd, target));
      if (!isWithinAny(options.allowedRoots, resolved)) {
        throw new Error(`Access denied: "${target}" is outside the sandbox (${options.allowedRoots[0]})`);
      }

      // Checked before the document is read or drawn: the answer is knowable now,
      // and doing the work first only to refuse afterwards wastes it.
      if (!/\.svg$/i.test(destination)) {
        throw new Error(
          `Cannot write "${destination}": a figure is an SVG file and must be named .svg. ` +
            "The interface serves and previews it by that extension, so another name renders nowhere.",
        );
      }
      const writeTo = await assertWritableDestination(destination, {
        cwd: options.cwd,
        writableRoot: options.writableRoot,
      });

      const stat = await fs.stat(resolved).catch(() => null);
      if (stat === null || !stat.isFile()) throw new Error(`No such file: ${target}`);
      if (stat.size > options.maxBytes) {
        throw new Error(`"${target}" is larger than the ${describeSize(options.maxBytes)} document limit`);
      }

      const text = await fs.readFile(resolved, "utf8");

      // Held to the project's profile exactly as presenting it would be: a figure is a
      // way for a document to leave, and one that strays from the model must not leave
      // this way when it could not be presented. A document the core contract refuses
      // falls through, so its refusal reads as it always has.
      const parsed = parseSerializedStructuredExchange(text, checkStructuredExchangeSchema, options.limits);
      if (parsed.valid) {
        const project = await readProjectProfiles(options.projectRoot);
        if (project.state === "unusable") {
          return {
            content: [
              {
                type: "text",
                text: [
                  "No figure was written. This project's structured-exchange profile registry cannot be used, so no document can be checked against it:",
                  ...describeUnusableProfiles(project.issues),
                ].join("\n"),
              },
            ],
            details: undefined,
            isError: true,
          };
        }
        if (project.state === "usable") {
          const held = holdToProfile(parsed.envelope, project.context);
          if (held.outcome === "refused") {
            const against = held.profile === undefined ? "this project's profile rules" : `this project's profile "${held.profile}"`;
            return {
              content: [
                {
                  type: "text",
                  text: [
                    `No figure was written. \`${target}\` strays from ${against}:`,
                    ...held.issues.map((issue) => `- ${issue.rule} at ${issue.path === "" ? "(document)" : issue.path}: ${issue.message}`),
                  ].join("\n"),
                },
              ],
              details: undefined,
              isError: true,
            };
          }
        }
      }

      const result = figureForDocument(
        text,
        checkStructuredExchangeSchema,
        {
          ...(hiddenElementKinds === undefined ? {} : { hiddenElementKinds }),
          ...(hiddenRelationshipKinds === undefined ? {} : { hiddenRelationshipKinds }),
          ...(viewpoint === undefined ? {} : { viewpoint }),
        },
        options.limits,
      );

      if (!result.ok) {
        // An error result, so the agent sees something to act on rather than a
        // write that happened to produce nothing. Nothing has been written.
        return {
          content: [
            {
              type: "text",
              text: `No figure was written. \`${target}\` ${describeFigureRefusal(result)}.`,
            },
          ],
          details: undefined,
          isError: true,
        };
      }

      // The folder is made rather than demanded. Figures collect in a directory of
      // their own — `figures/`, beside the document — and that directory does not
      // exist until the first figure is written. Refusing here left a sandboxed
      // agent with no way forward at all: it has `write` and `edit` and no mkdir,
      // and the confinement on this path has already been checked, so creating it
      // grants nothing that writing the file itself would not.
      await fs.mkdir(path.dirname(writeTo), { recursive: true });
      try {
        // "wx" does the existence check and the creation in one syscall: no window
        // in which the path could appear, and no chance of overwriting a file.
        await fs.writeFile(writeTo, result.svg, { flag: "wx" });
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "EEXIST") {
          throw new Error(`"${destination}" already exists; a figure is written to a new file only. Choose another path.`);
        }
        throw new Error(`Cannot write "${destination}": ${(error as Error).message}`);
      }

      return {
        content: [
          {
            type: "text",
            text: [
              `Wrote \`${destination}\` (${Buffer.byteLength(result.svg, "utf8")} bytes), showing ${describeCoverage(result.coverage)}.`,
              // Named before the statement, so an agent writing several figures from one
              // document can tell which chapter each belongs to without opening them.
              result.viewpoint === undefined
                ? undefined
                : `Drawn for viewpoint \`${result.viewpoint.id}\` (${result.viewpoint.label}).`,
              result.narrowing === undefined ? undefined : `The figure states: "${result.narrowing}"`,
              `Reference it from Markdown as a relative path, e.g. \`![${path.basename(destination, ".svg")}](${destination})\`.`,
            ]
              .filter((line) => line !== undefined)
              .join("\n"),
          },
        ],
        details: undefined,
      };
    },
  } as ToolDefinition;
}
