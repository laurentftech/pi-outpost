/**
 * The HTTP surface Open WebUI calls.
 *
 * Every route sits behind the same gate, installed before any of them: the bearer key
 * first, for every path including the OpenAPI description (Open WebUI sends it there
 * too), then — for the planning routes — the identity of the user Open WebUI acts
 * for. A refused request never reaches a handler, so no handler can forget to check.
 */
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { STRUCTURED_EXCHANGE_BYTES_CEILING_ANY } from "@pi-outpost/shared/structured-exchange/bounds";
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
  // Large enough for any document the contract accepts, even sent as a JSON string
  // (escaping can double it), so an oversized one is refused by the contract, which
  // names its ceiling, rather than by the HTTP layer, which names nothing.
  const bodyLimit = Math.max(config.maxPlanningBytes, STRUCTURED_EXCHANGE_BYTES_CEILING_ANY) * 2 + 64 * 1024;
  const app = Fastify({ logger: false, bodyLimit });
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
