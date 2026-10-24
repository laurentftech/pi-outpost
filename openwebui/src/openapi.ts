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
import {
  CREATE_DOCUMENT_DESCRIPTION,
  CREATE_PRESENTATION_DESCRIPTION,
  EDITS_DESCRIPTION,
  LIST_DOCUMENTS_DESCRIPTION,
  UPDATE_DOCUMENT_DESCRIPTION,
  UPDATE_PRESENTATION_DESCRIPTION,
  FILE_NAME_DESCRIPTION,
  KEEP_DESCRIPTION,
  LIST_TEMPLATES_DESCRIPTION,
  MARKDOWN_DESCRIPTION,
  SLIDES_DESCRIPTION,
  TEMPLATE_DESCRIPTION,
} from "./officeDescriptions.ts";
import { posterOperations } from "./posters.ts";

export { CREATION_EXAMPLE, STRUCTURE_EXAMPLES, UPDATE_EXAMPLE } from "@pi-outpost/apps-core/descriptions";
export { DOCUMENT_EXAMPLE, PRESENTATION_EXAMPLE, UPDATE_DOCUMENT_EXAMPLE, UPDATE_PRESENTATION_EXAMPLE } from "./officeDescriptions.ts";

/** One slide, as create_presentation takes it: the fields of pi-outpost's pptx_create, plus diagram and mermaid. */
const SLIDE_SCHEMA = {
  type: "object",
  properties: {
    layout: { type: "string", description: "Optional: a layout name from list_templates; chosen from the slide's content otherwise." },
    title: { type: "string" },
    subtitle: { type: "string" },
    bullets: { type: "array", items: { type: "string" } },
    table: {
      type: "object",
      description: "A native table: rows of texts, the first row the header.",
      properties: { rows: { type: "array", items: { type: "array", items: { type: "string" } } }, header: { type: "boolean" } },
      required: ["rows"],
    },
    chart: {
      type: "object",
      description: "A native chart.",
      properties: {
        type: { type: "string", enum: ["column", "bar", "line", "pie"] },
        title: { type: "string" },
        categories: { type: "array", items: { type: "string" } },
        series: { type: "array", items: { type: "object", properties: { name: { type: "string" }, values: { type: "array", items: { type: "number" } } }, required: ["name", "values"] } },
        stacked: { type: "boolean" },
        number_format: { type: "string" },
        show_values: { type: "boolean" },
      },
      required: ["type", "categories", "series"],
    },
    mermaid: { type: "string", description: "A Mermaid diagram's source, drawn as the slide's picture." },
    diagram: { type: "object", description: "A structured-exchange document, drawn as show_structure draws it." },
    image: {
      type: "object",
      description: "A picture: its bytes as a data: URI (PNG, JPEG or GIF).",
      properties: { data: { type: "string" }, alt: { type: "string" } },
      required: ["data"],
    },
  },
};

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
        "The user's project plannings (schedules, Gantt-like timelines), kept with every revision and shown as an interactive timeline in the chat; diagrams, sequences and tables drawn in the chat; and Word documents and PowerPoint decks the user downloads from the chat.",
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
      "/create_document": operation(
        "create_document",
        "Write a Word document",
        CREATE_DOCUMENT_DESCRIPTION,
        {
          file_name: { type: "string", description: FILE_NAME_DESCRIPTION },
          markdown: { type: "string", description: MARKDOWN_DESCRIPTION },
          template: { type: "string", description: TEMPLATE_DESCRIPTION },
          keep: { type: "array", items: { type: "string", enum: ["cover", "toc"] }, description: KEEP_DESCRIPTION },
        },
        ["file_name", "markdown"],
      ),
      "/create_presentation": operation(
        "create_presentation",
        "Write a PowerPoint deck",
        CREATE_PRESENTATION_DESCRIPTION,
        {
          file_name: { type: "string", description: FILE_NAME_DESCRIPTION },
          slides: { type: "array", description: SLIDES_DESCRIPTION, items: SLIDE_SCHEMA },
          template: { type: "string", description: TEMPLATE_DESCRIPTION },
        },
        ["file_name", "slides"],
      ),
      "/update_document": operation(
        "update_document",
        "Change a Word document written earlier",
        UPDATE_DOCUMENT_DESCRIPTION,
        {
          file_name: { type: "string", description: FILE_NAME_DESCRIPTION },
          edits: {
            type: "array",
            description: EDITS_DESCRIPTION,
            items: {
              type: "object",
              properties: {
                action: { type: "string", enum: ["replace", "insert_after", "append", "delete"] },
                section: { type: "string", description: "The section's heading, or its path Chapter/Section; not for append." },
                markdown: { type: "string", description: "The new content, in Markdown; not for delete." },
              },
              required: ["action"],
            },
          },
        },
        ["file_name", "edits"],
      ),
      "/update_presentation": operation(
        "update_presentation",
        "Change a PowerPoint deck written earlier",
        UPDATE_PRESENTATION_DESCRIPTION,
        {
          file_name: { type: "string", description: FILE_NAME_DESCRIPTION },
          edits: {
            type: "array",
            description: EDITS_DESCRIPTION,
            items: {
              type: "object",
              properties: {
                action: { type: "string", enum: ["insert_after", "replace", "delete", "move"] },
                slide: { type: "string", description: 'The slide, by its number ("3") or its exact title; "0" with insert_after puts the new slide first.' },
                after: { type: "string", description: 'For move: the slide to put it after, by number or title, or "0" for first.' },
                content: { ...SLIDE_SCHEMA, description: "For insert_after and replace: the slide, as create_presentation takes it." },
              },
              required: ["action", "slide"],
            },
          },
        },
        ["file_name", "edits"],
      ),
      "/list_documents": operation("list_documents", "List the documents kept for the user", LIST_DOCUMENTS_DESCRIPTION, {}, []),
      "/list_templates": operation("list_templates", "List the document templates", LIST_TEMPLATES_DESCRIPTION, {}, []),
      ...posterOperations(),
    },
  };
}

export function registerOpenApi(app: FastifyInstance): void {
  app.get("/openapi.json", { config: { identity: false } }, async () => openApiDocument());
}
