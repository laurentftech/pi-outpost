/**
 * The MCP server: the planning tools over the local store, and the view that draws a
 * planning in the host.
 *
 * The tools keep the Open WebUI server's contract, from the same code: the gate, the
 * targeted operations, the guide, and the descriptions with their examples all come
 * from `@pi-outpost/apps-core`. What differs is where plannings live — one person's
 * folder — and how a planning is shown: `show_planning` declares an MCP Apps view, a
 * `ui://` resource the host draws in the conversation, and hands it the planning as
 * structured content while the model reads a text summary.
 *
 * Exporting: a sandboxed view cannot download or always copy. "Download SVG" asks the
 * host (`ui/download-file`) when it offers that, and otherwise `save_figure`, a tool
 * only the view can call, writes the SVG into the plannings folder. Copying falls back
 * to the older copy command, which the sandbox does not refuse.
 *
 * The selection: a click in the view calls `select_in_planning`, a tool only the view
 * can call, and `get_planning` reports it. The view also offers the selection to the
 * host's model context, but Claude Desktop did not pass that on to the model when it was
 * tried, so the server is what remembers. One process serves one host, so a selection
 * made in the view is there when the model next reads the planning.
 */
import { createHash } from "node:crypto";
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { McpServer, type CallToolResult, type ReadResourceResult } from "@modelcontextprotocol/server";
import { z } from "zod";
import { compareTimelines } from "@pi-outpost/shared/structured-exchange/timeline-comparison";
import type { StructuredTimelineData } from "@pi-outpost/shared/structured-exchange";
import {
  BASE_REVISION_DESCRIPTION,
  COMPARE_TO_DESCRIPTION,
  CREATE_DESCRIPTION,
  GET_PLANNING_DESCRIPTION,
  LIST_PLANNINGS_DESCRIPTION,
  OPERATIONS_DESCRIPTION,
  PLANNING_ARGUMENT_DESCRIPTION,
  PLANNING_ID_DESCRIPTION,
  READ_GUIDE_DESCRIPTION,
  REVISION_DESCRIPTION,
  SHOW_PLANNING_DESCRIPTION,
  TOPIC_DESCRIPTION,
  UPDATE_DESCRIPTION,
} from "@pi-outpost/apps-core/descriptions";
import { GUIDE_TOPICS, guidePage } from "@pi-outpost/apps-core/guide";
import { OperationError, OPERATION_NAMES, applyOperations } from "@pi-outpost/apps-core/operations";
import { PlanningRefusal, type LocalPlanningStore, type PlanningRevision } from "./store.ts";

/**
 * The view's URI, named after its content. Claude Desktop keeps a view by its URI: a
 * bundle that changed the page under the same name was drawn with the old page, which
 * did not know the new result and drew nothing. A new page is a new name.
 */
export function viewUriFor(html: string): string {
  return `ui://pi-outpost/planning-${createHash("sha256").update(html).digest("hex").slice(0, 12)}.html`;
}
export const SERVER_NAME = "pi-outpost-plannings";

/** What the view receives from show_planning, as the tool result's structured content. */
export interface ShownPlanning {
  id: string;
  title: string;
  revision: number;
  data: StructuredTimelineData;
  /** Set when `data` compares this revision with an earlier one. */
  comparedWith?: number;
}

/** What the view receives from list_plannings: the folder and what it holds. */
export interface ListedPlannings {
  folder: string;
  plannings: Array<{ id: string; title: string; revision: number; file: string; updated: string; unreadable?: unknown }>;
}

interface Selection {
  task?: string;
  item?: string;
  at: number;
}

export interface ServerOptions {
  store: LocalPlanningStore;
  /** The view's single-file HTML page, read once at start. */
  viewHtml: string;
  version?: string;
  /** For tests: the clock the selection's age is measured with. */
  now?: () => number;
}

function text(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 1) }] };
}

function refusal(error: unknown): CallToolResult {
  if (error instanceof PlanningRefusal) {
    return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: error.message, ...error.details }, null, 1) }] };
  }
  throw error;
}

function ago(milliseconds: number): string {
  const minutes = Math.floor(milliseconds / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours} hour${hours === 1 ? "" : "s"} ago`;
}

/**
 * The selection, said so the model can act on "it": what was selected, its identifier,
 * its task. Undefined when nothing is selected, or what was selected no longer exists.
 */
export function describeSelection(data: StructuredTimelineData, selection: Selection | undefined, now: number): string | undefined {
  if (!selection) return undefined;
  for (const row of data.rows) {
    if (row.type !== "task") continue;
    if (selection.item !== undefined) {
      const item = row.items.find((candidate) => candidate.id === selection.item);
      if (!item) continue;
      const when = item.type === "milestone" ? `on ${item.date}` : `from ${item.start} to ${item.end}`;
      const name = item.label ?? item.kind ?? item.id;
      return `Selected in the view: ${item.type} "${name}" (${item.id}) of task "${row.label}" (${row.id}), ${when}, ${ago(now - selection.at)}.`;
    }
    if (row.id === selection.task) return `Selected in the view: task "${row.label}" (${row.id}), ${ago(now - selection.at)}.`;
  }
  return undefined;
}

export function createServer(options: ServerOptions): McpServer {
  const { store } = options;
  const now = options.now ?? Date.now;
  const selections = new Map<string, Selection>();
  const server = new McpServer({ name: SERVER_NAME, version: options.version ?? "0.0.0" });
  const VIEW_URI = viewUriFor(options.viewHtml);
  const id = z.string().describe(PLANNING_ID_DESCRIPTION);

  function revisionAnswer(revision: PlanningRevision) {
    return {
      id: revision.id,
      title: revision.title,
      revision: revision.revision,
      current_revision: revision.current,
      file: revision.file,
      planning: revision.document,
    };
  }

  /** What the model should know about the file beyond its content. */
  function fileNotes(revision: PlanningRevision) {
    if (revision.invalidFile) {
      return {
        file_refused: {
          note: `The file "${revision.file}" was edited outside and is no longer a valid planning. The planning above is the last valid revision; an update starts from it, replaces the file, and keeps the edited file in history. Tell the user, with these issues.`,
          issues: revision.invalidFile,
        },
      };
    }
    if (revision.editedOutside) {
      return { edited_outside: `The file "${revision.file}" was edited outside since revision ${revision.current}; the planning above is the file as it is now, and an update starts from it.` };
    }
    return {};
  }

  registerAppTool(
    server,
    "list_plannings",
    {
      title: "List the user's plannings",
      description: LIST_PLANNINGS_DESCRIPTION,
      // The same view as show_planning: given the list, it draws the folder.
      _meta: { ui: { resourceUri: VIEW_URI } },
    },
    async (): Promise<CallToolResult> => {
      const plannings = (await store.list()).map((listing) => ({
        id: listing.id,
        title: listing.title,
        revision: listing.revision,
        file: listing.file,
        updated: listing.updated,
        ...(listing.unreadable ? { unreadable: { note: "the file was edited outside and is not a valid planning", issues: listing.unreadable } } : {}),
      }));
      const listed: ListedPlannings = { folder: store.root, plannings };
      return { ...text(listed), structuredContent: listed as unknown as Record<string, unknown> };
    },
  );

  server.registerTool(
    "create_planning",
    {
      title: "Create a planning",
      description: CREATE_DESCRIPTION,
      inputSchema: z.object({ planning: z.record(z.string(), z.unknown()).describe(PLANNING_ARGUMENT_DESCRIPTION) }),
    },
    async ({ planning }) => {
      try {
        return text(revisionAnswer(await store.create(planning)));
      } catch (error) {
        return refusal(error);
      }
    },
  );

  server.registerTool(
    "get_planning",
    {
      title: "Read a planning",
      description: GET_PLANNING_DESCRIPTION,
      inputSchema: z.object({ id, revision: z.number().int().optional().describe(REVISION_DESCRIPTION) }),
      annotations: { readOnlyHint: true },
    },
    async ({ id: planningId, revision }) => {
      try {
        const found = await store.get(planningId, revision);
        const selected = found.revision === found.current ? describeSelection(found.document.data, selections.get(planningId), now()) : undefined;
        return text({ ...revisionAnswer(found), ...fileNotes(found), ...(selected ? { selected } : {}) });
      } catch (error) {
        return refusal(error);
      }
    },
  );

  server.registerTool(
    "update_planning",
    {
      title: "Change a planning",
      description: UPDATE_DESCRIPTION,
      inputSchema: z.object({
        id,
        base_revision: z.number().int().describe(BASE_REVISION_DESCRIPTION),
        operations: z.array(z.looseObject({ op: z.enum(OPERATION_NAMES) })).describe(OPERATIONS_DESCRIPTION),
      }),
    },
    async ({ id: planningId, base_revision: base, operations }) => {
      let failed: string | undefined;
      try {
        const revised = await store.revise(planningId, base, (current) => {
          try {
            return applyOperations(current, operations);
          } catch (error) {
            if (error instanceof OperationError) failed = error.message;
            throw error;
          }
        });
        const selection = selections.get(planningId);
        if (selection && !describeSelection(revised.document.data, selection, now())) selections.delete(planningId);
        return text(revisionAnswer(revised));
      } catch (error) {
        if (error instanceof OperationError) return refusal(new PlanningRefusal(`nothing was changed: ${failed ?? error.message}`));
        if (error instanceof PlanningRefusal && "issues" in error.details) {
          return refusal(new PlanningRefusal("nothing was changed: the result breaks the planning contract", error.details));
        }
        return refusal(error);
      }
    },
  );

  registerAppTool(
    server,
    "show_planning",
    {
      title: "Show a planning to the user",
      description: SHOW_PLANNING_DESCRIPTION,
      inputSchema: z.object({ id, compare_to: z.number().int().optional().describe(COMPARE_TO_DESCRIPTION) }),
      _meta: { ui: { resourceUri: VIEW_URI } },
    },
    async ({ id: planningId, compare_to: compareTo }): Promise<CallToolResult> => {
      try {
        const current = await store.get(planningId);
        let data = current.document.data;
        if (compareTo !== undefined) {
          const previous = await store.get(planningId, compareTo);
          data = compareTimelines(previous.document.data, current.document.data, `Revision ${compareTo}`).data;
        }
        const shown: ShownPlanning = { id: planningId, title: current.title, revision: current.revision, data, ...(compareTo !== undefined ? { comparedWith: compareTo } : {}) };
        const tasks = current.document.data.rows.filter((row) => row.type === "task").length;
        const summary = [
          `Shown to the user: planning "${current.title}" (${planningId}), revision ${current.revision}, ${tasks} task${tasks === 1 ? "" : "s"}, from ${current.document.data.time.start} to ${current.document.data.time.end}`,
          compareTo !== undefined ? `, compared with revision ${compareTo}` : "",
          ". You do not see the drawing: use get_planning to read the planning.",
          current.invalidFile ? ` The file "${current.file}" was edited outside into an invalid planning, so the last valid revision is shown: read it with get_planning to see why.` : "",
        ].join("");
        return { content: [{ type: "text", text: summary }], structuredContent: shown as unknown as Record<string, unknown> };
      } catch (error) {
        return refusal(error);
      }
    },
  );

  server.registerTool(
    "select_in_planning",
    {
      title: "Record the selection in a shown planning",
      description: "Called by the planning view when the user selects a task or an item, or unselects (neither given). Not for the model.",
      inputSchema: z.object({ id: z.string(), task: z.string().optional(), item: z.string().optional() }),
      // No resourceUri: the view is show_planning's. An app-only tool that also named it
      // left Claude Desktop drawing no view at all for show_planning.
      _meta: { ui: { visibility: ["app"] } },
    },
    async ({ id: planningId, task, item }): Promise<CallToolResult> => {
      if (task === undefined && item === undefined) {
        selections.delete(planningId);
        return text("Selection cleared.");
      }
      selections.set(planningId, { ...(task !== undefined ? { task } : {}), ...(item !== undefined ? { item } : {}), at: now() });
      return text("Selection recorded.");
    },
  );

  server.registerTool(
    "save_figure",
    {
      title: "Save an exported figure in the plannings folder",
      description: "Called by the planning view to save the timeline as an SVG file in the plannings folder, when the host cannot download files. Not for the model.",
      inputSchema: z.object({ file_name: z.string(), svg: z.string() }),
      // No resourceUri: the view is show_planning's. An app-only tool that also named it
      // left Claude Desktop drawing no view at all for show_planning.
      _meta: { ui: { visibility: ["app"] } },
    },
    async ({ file_name: fileName, svg }): Promise<CallToolResult> => {
      try {
        const saved = await store.saveFigure(fileName, svg);
        return { content: [{ type: "text", text: `Saved as "${saved}" in ${store.root}.` }], structuredContent: { file: saved, folder: store.root } };
      } catch (error) {
        return refusal(error);
      }
    },
  );

  server.registerTool(
    "read_structure_guide",
    {
      title: "Read the structured-exchange guide",
      description: READ_GUIDE_DESCRIPTION,
      inputSchema: z.object({ topic: z.enum(GUIDE_TOPICS.map((entry) => entry.topic) as [string, ...string[]]).optional().describe(TOPIC_DESCRIPTION) }),
      annotations: { readOnlyHint: true },
    },
    async ({ topic }) => {
      const topics = GUIDE_TOPICS.map(({ topic: name, purpose }) => ({ topic: name, purpose }));
      if (topic === undefined) return text({ topics, how: "Call read_structure_guide again with one topic, the one for the job at hand." });
      const page = guidePage(topic);
      if (page === undefined) return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: `there is no guide topic "${topic}"`, topics }) }] };
      return text({ topic, page });
    },
  );

  registerAppResource(server, "Planning timeline", VIEW_URI, { mimeType: RESOURCE_MIME_TYPE, description: "The interactive timeline a shown planning is drawn in." }, async (): Promise<ReadResourceResult> => ({
    // No CSP domains: the page is one self-contained file and fetches nothing.
    contents: [{ uri: VIEW_URI, mimeType: RESOURCE_MIME_TYPE, text: options.viewHtml }],
  }));

  return server;
}
