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
import { OperationError, applyOperations } from "./operations.ts";
import { PlanningRefusal, type PlanningRevision, type PlanningStore } from "./store.ts";

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
  if (error instanceof PlanningRefusal) return reply.code(error.status).send({ error: error.message, ...error.details });
  throw error;
}

export function planningRoutes(store: PlanningStore, _config: PlanningServerConfig): PlanningRoutes {
  return {
    register(app: FastifyInstance) {
      registerOpenApi(app);

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
