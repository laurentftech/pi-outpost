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
import { GUIDE_TOPICS } from "./guide.ts";
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
  id: "<the id get_planning returned>",
  base_revision: 1,
  operations: [
    { op: "change_item", id: "inspection", changes: { date: "2031-05-28" } },
    { op: "change_item", id: "frame", changes: { start: "2031-06-02", end: "2031-08-15" } },
    { op: "add_task", after: "G2", task: { id: "G3", label: "Handover", items: [{ type: "milestone", id: "handover", date: "2031-09-12", label: "Keys handed over" }] } },
    { op: "add_dependency", dependency: { from: "frame", to: "handover" } },
  ],
};

/**
 * show_structure's examples, one per kind and one proposal. From subjects no request
 * will resemble, for the reason the planning example is a greenhouse.
 */
export const STRUCTURE_EXAMPLES = {
  graph: {
    schema: "urn:structured-exchange:1",
    kind: "graph",
    data: {
      nodes: [
        { id: "member", label: "Member", kind: "actor" },
        { id: "desk", label: "Loan desk", kind: "process" },
        { id: "catalogue", label: "Catalogue", kind: "system" },
        { id: "copy", label: "Book copy", kind: "object" },
      ],
      edges: [
        { from: "member", to: "desk", kind: "request", label: "asks for a loan" },
        { from: "desk", to: "catalogue", kind: "query", label: "checks availability" },
        { from: "desk", to: "copy", kind: "handover", label: "lends" },
      ],
    },
  },
  sequence: {
    schema: "urn:structured-exchange:1",
    kind: "sequence",
    data: {
      participants: [
        { id: "courier", label: "Courier" },
        { id: "locker", label: "Parcel locker" },
        { id: "app", label: "Recipient app" },
      ],
      messages: [
        { from: "courier", to: "locker", label: "deposit parcel" },
        { from: "locker", to: "app", label: "pickup code" },
        { from: "app", to: "locker", label: "open compartment" },
      ],
    },
  },
  table: {
    schema: "urn:structured-exchange:1",
    kind: "table",
    data: {
      columns: ["Sample", "Origin", "Status"],
      rows: [
        ["S-104", "River outlet", "analysed"],
        ["S-105", "Well 3", "in freezer"],
      ],
    },
  },
  proposal: {
    schema: "urn:structured-exchange:1",
    kind: "graph",
    target: "library-lending",
    removals: [{ type: "element", ref: "EL-4", label: "Card index" }],
    data: {
      nodes: [
        { id: "desk", ref: "EL-2", label: "Loan desk", set: { label: "Self-service kiosk" } },
        { id: "catalogue", ref: "EL-3", label: "Catalogue" },
        { id: "reminder", label: "Return reminder", kind: "process" },
      ],
      edges: [{ from: "reminder", to: "catalogue", kind: "query", label: "reads due dates" }],
    },
  },
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
Then, once this call has answered, call show_planning with the id it returned so the user sees it — never in the same step, since the id does not exist before. For dependencies, closures and key dates beyond this example, read_structure_guide with topic "timelines" has the full reference.`;

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

const STRUCTURE_DESCRIPTION = `Shows the user a structured document drawn natively in the chat: a graph (elements and relationships: an architecture, a process, a data flow), a sequence (participants exchanging messages in order), a table, or a timeline. Emit data, never diagram syntax and never coordinates or colours.
The document is checked against the structured-exchange contract. If it is refused you get the rule and a pointer to the value: correct the document yourself and call again at once — never ask the user to fix it. You do not see the drawing: the document you pass stays in this conversation as your call's argument.
Kinds: "graph" data {nodes:[{id,label,kind?}], edges:[{from,to,kind,label?}]} (every new relationship needs a kind, a free word such as "flow" or "uses"); "sequence" data {participants:[{id,label}], messages:[{from,to,label}]}; "table" data {columns:[…], rows:[[…]]}; a timeline is schema 3 (see create_planning for a planning to keep and change over time).
To PROPOSE a change to something that already exists, set "target" (its name) and describe only what changes: a new element has no "ref"; an existing one carries its "ref", and its other fields only describe it — put what changes in "set": {"field": new value}; removals are listed in "removals" [{"type":"element"|"relationship","ref"}]. Every element a relationship touches must be in "nodes": an existing one as context, with its "ref" and its label and no "set". Omitting an element never removes it. A proposal is shown for the user to judge; nothing is applied, so never say it was.
Write labels in the user's language with the user's names. The examples below only show the form; take nothing else from them.
For anything beyond them, read_structure_guide has the full reference, one topic per job: "graphs-and-tables" (containers, row roles, viewpoints), "proposals", "timelines", "enriched" (version 2: attributes, requirements tables with headings and traceability). Read the topic before writing a kind you have not written in this conversation.
Graph:${fence(STRUCTURE_EXAMPLES.graph)}Sequence:${fence(STRUCTURE_EXAMPLES.sequence)}Table:${fence(STRUCTURE_EXAMPLES.table)}Proposal (changes one element, adds one, removes one):${fence(STRUCTURE_EXAMPLES.proposal)}`;

const idProperty = {
  type: "string",
  description: "The planning's id, exactly as list_plannings or create_planning returned it. Never guess one: call those first and wait for their answer.",
};

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
      title: "pi-outpost",
      version: "0.1.0",
      description:
        "The user's project plannings (schedules, Gantt-like timelines), kept with every revision and shown as an interactive timeline in the chat; and diagrams, sequences and tables drawn in the chat.",
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
      "/show_structure": operation(
        "show_structure",
        "Show a diagram, sequence or table",
        STRUCTURE_DESCRIPTION,
        {
          document: {
            type: "object",
            description: "The whole structured-exchange document: {\"schema\":\"urn:structured-exchange:1\",\"kind\":…,\"data\":{…}}, plus \"target\" and \"removals\" for a proposal.",
          },
          summary: { type: "string", description: "Optional: one sentence on what the document shows." },
        },
        ["document"],
      ),
      "/read_structure_guide": operation(
        "read_structure_guide",
        "Read the structured-exchange guide",
        "Returns the reference page for writing structured documents, by topic: graphs-and-tables, proposals, timelines, enriched. Without a topic, lists them. Read it before writing an unfamiliar kind, and when a refusal names a topic.",
        { topic: { type: "string", enum: GUIDE_TOPICS.map((entry) => entry.topic), description: "The topic to read; omit to list them." } },
        [],
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
