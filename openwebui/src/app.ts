/**
 * The HTTP surface Open WebUI calls.
 *
 * Every route sits behind the same gate, installed before any of them: the bearer key
 * first, for every path including the OpenAPI description (Open WebUI sends it there
 * too), then — for the planning routes — the identity of the user Open WebUI acts
 * for. A refused request never reaches a handler, so no handler can forget to check.
 */
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import type { PlanningServerConfig } from "./config.ts";
import { bearerMatches, resolveOwner } from "./trust.ts";

declare module "fastify" {
  interface FastifyRequest {
    /** The Open WebUI user this request acts for; set on planning routes only. */
    owner: string;
  }
  interface FastifyContextConfig {
    /** False for routes that act for nobody, such as the OpenAPI description. */
    identity?: boolean;
  }
}

export interface PlanningRoutes {
  register(app: FastifyInstance): void;
}

export function ownerOf(request: FastifyRequest): string {
  return request.owner;
}

export function buildApp(config: PlanningServerConfig, routes: PlanningRoutes): FastifyInstance {
  const app = Fastify({ logger: false, bodyLimit: config.maxPlanningBytes * 2 + 64 * 1024 });
  app.decorateRequest("owner", "");

  app.addHook("onRequest", async (request, reply) => {
    if (!bearerMatches(request.headers.authorization, config.secret)) {
      return reply.code(401).send({ error: "unauthorised" });
    }
    if (request.routeOptions.config?.identity === false) return;
    const verdict = resolveOwner(request.headers, config.identity, config.identityKey);
    if ("refused" in verdict) return reply.code(401).send({ error: verdict.refused });
    request.owner = verdict.owner;
  });

  routes.register(app);
  return app;
}
