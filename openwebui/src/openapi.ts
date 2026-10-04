/**
 * The OpenAPI description Open WebUI reads to build its tools: one tool per operation,
 * named by `operationId`, described by `description`. Weak models read the tool
 * description and nothing else, so each one carries what using the tool takes.
 */
import type { FastifyInstance } from "fastify";

const idProperty = { type: "string", description: "The planning's identifier, as list_plannings or create_planning gave it (pl_…)." };

function operation(operationId: string, summary: string, description: string, properties: Record<string, unknown>, required: string[]) {
  return {
    post: {
      operationId,
      summary,
      description,
      requestBody: {
        required: true,
        content: { "application/json": { schema: { type: "object", properties, required, additionalProperties: false } } },
      },
      responses: { 200: { description: "OK" } },
    },
  };
}

export function openApiDocument(serverUrl?: string) {
  return {
    openapi: "3.1.0",
    info: {
      title: "Plannings",
      version: "0.1.0",
      description: "Personal project plannings, kept as structured-exchange timelines with every revision, shown as an interactive timeline.",
    },
    ...(serverUrl ? { servers: [{ url: serverUrl }] } : {}),
    paths: {
      "/list_plannings": operation("list_plannings", "List my plannings", "Lists the user's plannings: id, title, current revision, last change. Call it first to find a planning by name.", {}, []),
      "/create_planning": operation(
        "create_planning",
        "Create a planning",
        "Stores a new planning, a structured-exchange version 3 timeline document. Returns its id and revision 1. Items without an id get one.",
        { planning: { type: "object", description: "The whole timeline document: {schema, kind: \"timeline\", data}." } },
        ["planning"],
      ),
      "/get_planning": operation(
        "get_planning",
        "Read a planning",
        "Returns a planning's document and revision number. Read it before changing it. Give `revision` to read an earlier one.",
        { id: idProperty, revision: { type: "integer", description: "An earlier revision number; omit for the current one." } },
        ["id"],
      ),
      "/show_planning": operation(
        "show_planning",
        "Show a planning",
        "Shows the planning to the user as an interactive timeline in the chat. You will not see it yourself: use get_planning to read its content. Give `compare_to` to show what moved since an earlier revision.",
        { id: idProperty, compare_to: { type: "integer", description: "An earlier revision to compare the current one with." } },
        ["id"],
      ),
    },
  };
}

export function registerOpenApi(app: FastifyInstance): void {
  app.get("/openapi.json", { config: { identity: false } }, async () => openApiDocument());
}
