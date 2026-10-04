/**
 * The OpenAPI description Open WebUI reads to build its tools: one tool per operation,
 * named by `operationId`, described by `description`. The descriptions and examples
 * are `@pi-outpost/apps-core`'s, shared with the MCP server.
 */
import type { FastifyInstance } from "fastify";
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
  STRUCTURE_DESCRIPTION,
  TOPIC_DESCRIPTION,
  UPDATE_DESCRIPTION,
} from "@pi-outpost/apps-core/descriptions";
import { GUIDE_TOPICS } from "@pi-outpost/apps-core/guide";
import { OPERATION_NAMES } from "@pi-outpost/apps-core/operations";

export { CREATION_EXAMPLE, STRUCTURE_EXAMPLES, UPDATE_EXAMPLE } from "@pi-outpost/apps-core/descriptions";

const idProperty = {
  type: "string",
  description: PLANNING_ID_DESCRIPTION,
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
        LIST_PLANNINGS_DESCRIPTION,
        {},
        [],
      ),
      "/create_planning": operation(
        "create_planning",
        "Create a planning",
        CREATE_DESCRIPTION,
        { planning: { type: "object", description: PLANNING_ARGUMENT_DESCRIPTION } },
        ["planning"],
      ),
      "/get_planning": operation(
        "get_planning",
        "Read a planning",
        GET_PLANNING_DESCRIPTION,
        { id: idProperty, revision: { type: "integer", description: REVISION_DESCRIPTION } },
        ["id"],
      ),
      "/update_planning": operation(
        "update_planning",
        "Change a planning",
        UPDATE_DESCRIPTION,
        {
          id: idProperty,
          base_revision: { type: "integer", description: BASE_REVISION_DESCRIPTION },
          operations: {
            type: "array",
            description: OPERATIONS_DESCRIPTION,
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
        READ_GUIDE_DESCRIPTION,
        { topic: { type: "string", enum: GUIDE_TOPICS.map((entry) => entry.topic), description: TOPIC_DESCRIPTION } },
        [],
      ),
      "/show_planning": operation(
        "show_planning",
        "Show a planning to the user",
        SHOW_PLANNING_DESCRIPTION,
        { id: idProperty, compare_to: { type: "integer", description: COMPARE_TO_DESCRIPTION } },
        ["id"],
      ),
    },
  };
}

export function registerOpenApi(app: FastifyInstance): void {
  app.get("/openapi.json", { config: { identity: false } }, async () => openApiDocument());
}
