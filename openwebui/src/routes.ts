/**
 * The planning tools, one route each. Open WebUI turns each operation of the OpenAPI
 * description into a tool named by its `operationId`, so a route's path, operation id
 * and tool name are the same word.
 *
 * Answers are written for a model to read: a refusal says what was refused and why,
 * with the contract's diagnostics when there are some, never just a status code.
 */
import type { FastifyInstance, FastifyReply } from "fastify";
import type { PlanningRoutes } from "./app.ts";
import type { PlanningServerConfig } from "./config.ts";
import { compareTimelines } from "@pi-outpost/shared/structured-exchange/timeline-comparison";
import { embedPage } from "./embed.ts";
import { registerOpenApi } from "./openapi.ts";
import { GUIDE_TOPICS, guidePage, guideTopicFor } from "@pi-outpost/apps-core/guide";
import { judgeStructure } from "@pi-outpost/apps-core/structure";
import { OperationError, applyOperations } from "@pi-outpost/apps-core/operations";
import { PlanningRefusal, type PlanningRevision, type PlanningStore } from "./store.ts";
import { createMermaidRenderer, type MermaidRenderer } from "@pi-outpost/office/mermaidRender.ts";
import {
  describeTemplates,
  downloadName,
  OfficeRefusal,
  outlineOf,
  POWERPOINT_MEDIA_TYPE,
  updatePresentationFile,
  updateWordFile,
  writePresentation,
  writeWordDocument,
  type OfficeSettings,
  type WrittenFile,
} from "./office.ts";
import { DocumentStore } from "./documents.ts";

function revisionAnswer(revision: PlanningRevision) {
  return {
    id: revision.id,
    title: revision.title,
    revision: revision.revision,
    current_revision: revision.current,
    planning: revision.document,
  };
}

function refuse(reply: FastifyReply, error: unknown) {
  if (error instanceof PlanningRefusal || error instanceof OfficeRefusal) return reply.code(error.status).send({ error: error.message, ...error.details });
  throw error;
}

/** The written file as the page Open WebUI embeds: the file inside, a download button on it. */
function sendDownload(reply: FastifyReply, file: WrittenFile) {
  return reply
    .header("Content-Type", "text/html; charset=utf-8")
    .header("Content-Disposition", "inline")
    .header("Access-Control-Expose-Headers", "Content-Disposition")
    .send(
      embedPage({
        mode: "download",
        fileName: file.fileName,
        mediaType: file.mediaType,
        size: file.bytes.length,
        data: file.bytes.toString("base64"),
        outline: file.outline,
        figures: file.figures,
        template: file.template,
      }),
    );
}

export interface PlanningRouteOptions {
  /** Draws Mermaid fences and slides; one is made, and closed with the server, when none is given. */
  mermaid?: MermaidRenderer;
  /** The Mermaid worker's module, for a bundled server; see `createMermaidRenderer`. */
  mermaidWorker?: URL;
}

export function planningRoutes(store: PlanningStore, config: PlanningServerConfig, options: PlanningRouteOptions = {}): PlanningRoutes {
  return {
    register(app: FastifyInstance) {
      registerOpenApi(app);

      const mermaid = options.mermaid ?? createMermaidRenderer(options.mermaidWorker ? { workerUrl: options.mermaidWorker } : {});
      if (options.mermaid === undefined) app.addHook("onClose", () => mermaid.close());
      const office: OfficeSettings = { templatesDir: config.templatesDir, maxFileBytes: config.maxFileBytes, maxImageBytes: config.maxImageBytes, mermaid };

      // The file is packed into the embed, and kept under its name for the user, so a later
      // call can change it (update_document, update_presentation) instead of rewriting it.
      const documents = new DocumentStore(config);
      const keep = async (owner: string, file: WrittenFile) => {
        await documents.save(owner, file);
        return file;
      };
      /** A kept file by the name the model gave it, or a refusal naming the ones there are. */
      const kept = async (owner: string, given: unknown, extension: ".docx" | ".pptx") => {
        const fileName = downloadName(given, extension);
        const found = await documents.get(owner, fileName);
        if (found !== undefined) return found;
        const names = (await documents.list(owner)).filter((meta) => meta.fileName.toLowerCase().endsWith(extension)).map((meta) => meta.fileName);
        throw new OfficeRefusal(
          names.length === 0
            ? `there is no ${extension} file named "${fileName}" kept for this user: write it first with ${extension === ".pptx" ? "create_presentation" : "create_document"}`
            : `there is no ${extension} file named "${fileName}" kept for this user; the ones there are: ${names.join(", ")}`,
          { documents: names },
        );
      };

      app.post<{ Body: { file_name?: unknown; markdown?: unknown; template?: unknown; keep?: unknown } }>("/create_document", async (request, reply) => {
        try {
          return sendDownload(reply, await keep(request.owner, await writeWordDocument(office, request.body ?? {})));
        } catch (error) {
          return refuse(reply, error);
        }
      });

      app.post<{ Body: { file_name?: unknown; slides?: unknown; template?: unknown } }>("/create_presentation", async (request, reply) => {
        try {
          return sendDownload(reply, await keep(request.owner, await writePresentation(office, request.body ?? {})));
        } catch (error) {
          return refuse(reply, error);
        }
      });

      app.post<{ Body: { file_name?: unknown; edits?: unknown } }>("/update_document", async (request, reply) => {
        try {
          const fileName = downloadName(request.body?.file_name, ".docx");
          const file = await documents.exclusive(request.owner, fileName, async () =>
            keep(request.owner, await updateWordFile(office, await kept(request.owner, fileName, ".docx"), request.body ?? {})),
          );
          return sendDownload(reply, file);
        } catch (error) {
          return refuse(reply, error);
        }
      });

      app.post<{ Body: { file_name?: unknown; edits?: unknown } }>("/update_presentation", async (request, reply) => {
        try {
          const fileName = downloadName(request.body?.file_name, ".pptx");
          const file = await documents.exclusive(request.owner, fileName, async () =>
            keep(request.owner, await updatePresentationFile(office, await kept(request.owner, fileName, ".pptx"), request.body ?? {})),
          );
          return sendDownload(reply, file);
        } catch (error) {
          return refuse(reply, error);
        }
      });

      // Text, for the model: what it can change, and how to name a section or a slide.
      app.post("/list_documents", async (request) => {
        const listed = [];
        for (const meta of await documents.list(request.owner)) {
          const found = await documents.get(request.owner, meta.fileName);
          const outline = found === undefined ? [] : outlineOf(meta.mediaType, found.bytes);
          listed.push(
            meta.mediaType === POWERPOINT_MEDIA_TYPE
              ? { file_name: meta.fileName, format: "powerpoint", updated: meta.updated, slides: outline.map((entry, index) => ({ number: index + 1, title: entry.text })) }
              : { file_name: meta.fileName, format: "word", updated: meta.updated, headings: outline.map((entry) => `${"#".repeat(entry.level)} ${entry.text}`) },
          );
        }
        return {
          documents: listed,
          how:
            listed.length === 0
              ? "No documents are kept for this user yet: create_document and create_presentation keep what they write."
              : "Change one with update_document or update_presentation, naming it by file_name and its sections by heading or its slides by number or title.",
        };
      });

      app.post("/list_templates", async () => {
        const templates = await describeTemplates(office);
        return {
          templates,
          how:
            templates.length === 0
              ? "No templates are provided here: leave template out, and create_document and create_presentation use their built-in one."
              : "Name a template by its name in create_document (a Word one) or create_presentation (a PowerPoint one), or leave template out for the built-in one.",
        };
      });

      app.post("/list_plannings", async (request, reply) => {
        try {
          const plannings = await store.list(request.owner);
          return { plannings: plannings.map((meta) => ({ id: meta.id, title: meta.title, revision: meta.revision, updated: meta.updated })) };
        } catch (error) {
          return refuse(reply, error);
        }
      });

      app.post<{ Body: { planning?: unknown } }>("/create_planning", async (request, reply) => {
        try {
          const created = await store.create(request.owner, request.body?.planning);
          return reply.code(201).send(revisionAnswer(created));
        } catch (error) {
          return refuse(reply, error);
        }
      });

      app.post<{ Body: { id?: unknown; revision?: unknown } }>("/get_planning", async (request, reply) => {
        try {
          const { id, revision } = request.body ?? {};
          if (typeof id !== "string") return reply.code(422).send({ error: "id is required: the planning's identifier, from list_plannings" });
          if (revision !== undefined && revision !== null && !Number.isInteger(revision)) {
            return reply.code(422).send({ error: "revision, when given, is a revision number" });
          }
          return revisionAnswer(await store.get(request.owner, id, (revision ?? undefined) as number | undefined));
        } catch (error) {
          return refuse(reply, error);
        }
      });

      app.post<{ Body: { id?: unknown; base_revision?: unknown; operations?: unknown } }>("/update_planning", async (request, reply) => {
        try {
          const { id, base_revision: base, operations } = request.body ?? {};
          if (typeof id !== "string") return reply.code(422).send({ error: "id is required: the planning's identifier, from list_plannings" });
          if (!Number.isInteger(base)) {
            return reply.code(422).send({ error: "base_revision is required: the revision you read with get_planning" });
          }
          let failed: string | undefined;
          try {
            const revised = await store.revise(request.owner, id, base as number, (current) => {
              try {
                return applyOperations(current, operations);
              } catch (error) {
                if (error instanceof OperationError) failed = error.message;
                throw error;
              }
            });
            return revisionAnswer(revised);
          } catch (error) {
            if (error instanceof OperationError) {
              return reply.code(422).send({ error: `nothing was changed: ${failed ?? error.message}` });
            }
            if (error instanceof PlanningRefusal && error.status === 422 && "issues" in error.details) {
              return reply.code(422).send({ error: "nothing was changed: the result breaks the planning contract", ...error.details });
            }
            throw error;
          }
        } catch (error) {
          return refuse(reply, error);
        }
      });

      // Stateless, as pi-outpost's present_structure is: nothing is stored, and the
      // document stays in the conversation as this call's own argument.
      app.post<{ Body: { document?: unknown; summary?: unknown } }>("/show_structure", async (request, reply) => {
        const verdict = judgeStructure(request.body?.document);
        if (!verdict.valid) {
          // The page that would have helped, named where the model is most likely to
          // follow a pointer: in the refusal it has just received.
          const guide = guideTopicFor(request.body?.document, verdict.issues);
          return reply.code(422).send({
            // Said to the model, not the user: Codestral read the first wording as a
            // message to relay, and asked the user to fix a document it had written.
            error:
              "Nothing was shown: the structured-exchange contract refused this document. This message is for you, not for the user: correct the document using the issues below and call show_structure again now, in this same reply." +
              ` If the rule is unclear, read_structure_guide with topic "${guide}" explains it.`,
            guide,
            issues: verdict.issues,
          });
        }
        return reply
          .header("Content-Type", "text/html; charset=utf-8")
          .header("Content-Disposition", "inline")
          .header("Access-Control-Expose-Headers", "Content-Disposition")
          .send(embedPage({ mode: "structure", envelope: verdict.envelope }));
      });

      // The guide: pi-outpost's skill reference pages, for the model to read. Text, not an
      // embed, so the model sees it.
      app.post<{ Body: { topic?: unknown } }>("/read_structure_guide", async (request, reply) => {
        const topics = GUIDE_TOPICS.map(({ topic, purpose }) => ({ topic, purpose }));
        const topic = request.body?.topic;
        if (topic === undefined || topic === null || topic === "") {
          return { topics, how: "Call read_structure_guide again with one topic, the one for the job at hand." };
        }
        const page = typeof topic === "string" ? guidePage(topic) : undefined;
        if (page === undefined) {
          return reply.code(404).send({ error: `there is no guide topic "${String(topic)}"`, topics });
        }
        return { topic, page };
      });

      app.post<{ Body: { id?: unknown; compare_to?: unknown } }>("/show_planning", async (request, reply) => {
        try {
          const { id, compare_to: compareTo } = request.body ?? {};
          if (typeof id !== "string") return reply.code(422).send({ error: "id is required: the planning's identifier, from list_plannings" });
          if (compareTo !== undefined && compareTo !== null && !Number.isInteger(compareTo)) {
            return reply.code(422).send({ error: "compare_to, when given, is the number of an earlier revision" });
          }
          const current = await store.get(request.owner, id);
          let data = current.document.data;
          let comparedWith: number | undefined;
          if (typeof compareTo === "number") {
            const previous = await store.get(request.owner, id, compareTo);
            data = compareTimelines(previous.document.data, current.document.data, `Revision ${compareTo}`).data;
            comparedWith = compareTo;
          }
          const html = embedPage({ id, title: current.title, revision: current.revision, data, ...(comparedWith ? { comparedWith } : {}) });
          return reply
            .header("Content-Type", "text/html; charset=utf-8")
            .header("Content-Disposition", "inline")
            .header("Access-Control-Expose-Headers", "Content-Disposition")
            .send(html);
        } catch (error) {
          return refuse(reply, error);
        }
      });
    },
  };
}
