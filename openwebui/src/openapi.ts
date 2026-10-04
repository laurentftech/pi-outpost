/**
 * The OpenAPI description Open WebUI reads to build its tools: one tool per operation,
 * named by `operationId`, described by `description`.
 *
 * Weak models read the tool description and nothing else — no skill, no reference
 * page — so each description carries what using the tool takes, and the two that
 * write carry a complete example: a whole minimal planning for creation, a whole
 * update for changing it. The tests run both examples from this very document, so an
 * example cannot drift from what the server accepts.
 */
import type { FastifyInstance } from "fastify";
import { OPERATION_NAMES } from "./operations.ts";

/**
 * A complete minimal planning: the creation example. Deliberately from an unrelated
 * field, with odd dates: weak models copy an example's labels and dates when it looks
 * like the request (observed with Codestral on a website request against a website
 * example), so the example must not look like anything a user would ask for.
 */
export const CREATION_EXAMPLE = {
  schema: "urn:structured-exchange:3",
  kind: "timeline",
  data: {
    title: "Greenhouse construction",
    time: { start: "2031-04-01", end: "2031-09-30", scale: "month" },
    rows: [
      { type: "separator", label: "Site" },
      {
        type: "task",
        id: "G1",
        label: "Foundations",
        items: [
          { type: "activity", id: "earthworks", start: "2031-04-07", end: "2031-05-16", label: "Earthworks" },
          { type: "milestone", id: "inspection", date: "2031-05-21", kind: "Inspection", label: "Soil inspection" },
        ],
      },
      { type: "separator", label: "Structure" },
      {
        type: "task",
        id: "G2",
        label: "Frame and glazing",
        items: [{ type: "activity", id: "frame", start: "2031-05-26", end: "2031-08-08", label: "Steel frame" }],
      },
    ],
    dependencies: [{ from: "inspection", to: "frame" }],
  },
};

/** A complete update of the creation example, at revision 1. */
export const UPDATE_EXAMPLE = {
  id: "pl_…",
  base_revision: 1,
  operations: [
    { op: "change_item", id: "inspection", changes: { date: "2031-05-28" } },
    { op: "change_item", id: "frame", changes: { start: "2031-06-02", end: "2031-08-15" } },
    { op: "add_task", after: "G2", task: { id: "G3", label: "Handover", items: [{ type: "milestone", id: "handover", date: "2031-09-12", label: "Keys handed over" }] } },
    { op: "add_dependency", dependency: { from: "frame", to: "handover" } },
  ],
};

const fence = (value: unknown) => `\n\`\`\`json\n${JSON.stringify(value, null, 1)}\n\`\`\`\n`;

const CREATE_DESCRIPTION = `Stores a new planning (a project schedule) for the user and returns its id and revision 1.
The planning is a structured-exchange version 3 timeline document:
- data.time: start and end dates (YYYY-MM-DD) and scale: "week", "month" or "quarter".
- data.rows, in display order: {"type":"separator","label":…} to group tasks, or {"type":"task","id":…,"label":…,"items":[…]}.
- items: {"type":"activity","start":…,"end":…} or {"type":"milestone","date":…}, each with an optional id, label and kind (kind is a free category such as "Review").
- data.dependencies (optional): {"from":id,"to":id}, ids of tasks or items; type may be "finish-to-start" (default), "start-to-start", "finish-to-finish" or "start-to-finish".
- data.periods (optional): closures, [{"start","end","label"}]. data.references (optional): key dates, [{"date","label"}].
Every date must fall inside data.time. Give every item an id: you change items by id later. No colours, sizes or positions.
Write titles and labels in the user's language, with the user's own names and exact dates ("end of May" is the 31st). The example below only shows the form; take nothing else from it.
Complete example of the planning argument (a different project):${fence(CREATION_EXAMPLE)}
Then call show_planning with the returned id so the user sees it.`;

const UPDATE_DESCRIPTION = `Changes a planning with a list of operations, all applied or none. Read the planning with get_planning first, and pass the revision you read as base_revision; if someone changed it since, you are told to read it again.
Operations (by id; separators by their row index in data.rows):
- {"op":"set_title","title":…} · {"op":"set_time","start"?,"end"?,"scale"?} · {"op":"set_periods","periods":[…]} · {"op":"set_references","references":[…]}
- {"op":"add_task","task":{"id","label","items":[…]},"before"|"after":task id or "index":n} · {"op":"change_task","id","label"?,"new_id"?} · {"op":"move_task","id","before"|"after"|"index"} · {"op":"remove_task","id"}
- {"op":"add_item","task":task id,"item":{…}} · {"op":"change_item","id","changes":{field: new value, null removes it, "task": move to another task}} · {"op":"remove_item","id"}
- {"op":"add_separator","label"?,"before"|"after"|"index"} · {"op":"remove_separator","row":n}
- {"op":"add_dependency","dependency":{"from","to","type"?}} · {"op":"remove_dependency","from","to"}
To shift or delay an activity, change both its start and its end by the same amount; change only one to lengthen or shorten it.
Removing a task or an item removes its dependencies. A refused update changes nothing and says why.
Complete example, on another project (delays the inspection a week, shifts the frame a week, both ends, adds a handover milestone after it):${fence(UPDATE_EXAMPLE)}
Then call show_planning with compare_to set to the revision you started from, so the user sees what moved.`;

const idProperty = { type: "string", description: "The planning's id (pl_…), from list_plannings or create_planning." };

function operation(operationId: string, summary: string, description: string, properties: Record<string, unknown>, required: string[]) {
  return {
    post: {
      operationId,
      summary,
      description,
      requestBody: {
        required: true,
        content: { "application/json": { schema: { type: "object", properties, required } } },
      },
      responses: { 200: { description: "OK" } },
    },
  };
}

export function openApiDocument() {
  return {
    openapi: "3.1.0",
    info: {
      title: "Plannings",
      version: "0.1.0",
      description:
        "The user's project plannings (schedules, Gantt-like timelines), kept with every revision and shown as an interactive timeline in the chat.",
    },
    paths: {
      "/list_plannings": operation(
        "list_plannings",
        "List the user's plannings",
        "Lists the user's plannings: id, title, current revision, last change. Call it first to find a planning the user names.",
        {},
        [],
      ),
      "/create_planning": operation(
        "create_planning",
        "Create a planning",
        CREATE_DESCRIPTION,
        { planning: { type: "object", description: "The whole timeline document: {\"schema\":\"urn:structured-exchange:3\",\"kind\":\"timeline\",\"data\":{…}}." } },
        ["planning"],
      ),
      "/get_planning": operation(
        "get_planning",
        "Read a planning",
        "Returns a planning's whole document and its revision. Read it before answering questions about it or changing it. Give revision to read an earlier one.",
        { id: idProperty, revision: { type: "integer", description: "An earlier revision number; omit for the current one." } },
        ["id"],
      ),
      "/update_planning": operation(
        "update_planning",
        "Change a planning",
        UPDATE_DESCRIPTION,
        {
          id: idProperty,
          base_revision: { type: "integer", description: "The revision you read with get_planning." },
          operations: {
            type: "array",
            description: "The changes, applied in order.",
            items: { type: "object", properties: { op: { type: "string", enum: [...OPERATION_NAMES] } }, required: ["op"] },
          },
        },
        ["id", "base_revision", "operations"],
      ),
      "/show_planning": operation(
        "show_planning",
        "Show a planning to the user",
        "Shows the planning to the user as an interactive timeline in the chat. You do not see it yourself: use get_planning to know its content. Give compare_to (an earlier revision) to show what moved since then.",
        { id: idProperty, compare_to: { type: "integer", description: "An earlier revision to compare the current one with." } },
        ["id"],
      ),
    },
  };
}

export function registerOpenApi(app: FastifyInstance): void {
  app.get("/openapi.json", { config: { identity: false } }, async () => openApiDocument());
}
