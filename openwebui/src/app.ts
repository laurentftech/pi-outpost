/**
 * The HTTP surface Open WebUI calls.
 *
 * Every route sits behind the same gate, installed before any of them: the bearer key
 * first, for every path including the OpenAPI description (Open WebUI sends it there
 * too), then — for the planning routes — the identity of the user Open WebUI acts
 * for. A refused request never reaches a handler, so no handler can forget to check.
 */
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { MAX_POSTER_BYTES } from "@pi-outpost/posters/format";
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
    /** Browser-facing route that authenticates a narrowly scoped capability instead. */
    publicCapability?: boolean;
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
  // A document's pictures travel in the call as base64, a third larger than the file
  // they end up in, which the file limit bounds.
  // A poster's pictures are embedded in it as base64: a poster at its ceiling, JSON-escaped
  // (its markup's quotes, little else), must reach the format's refusal too.
  const bodyLimit = Math.max(Math.max(config.maxPlanningBytes, STRUCTURED_EXCHANGE_BYTES_CEILING_ANY) * 2, config.maxFileBytes * 2, MAX_POSTER_BYTES * 2) + 64 * 1024;
  const app = Fastify({ logger: false, bodyLimit });
  app.decorateRequest("owner", "");

  app.addHook("onRequest", async (request, reply) => {
    if (request.routeOptions.config?.publicCapability) {
      if (!config.webUiOrigin || request.headers.origin !== config.webUiOrigin) {
        return reply.code(403).send({ error: "origin is not allowed to save posters" });
      }
      reply.header("access-control-allow-origin", config.webUiOrigin).header("vary", "Origin").header("cache-control", "no-store");
      if (request.method === "OPTIONS") {
        return reply
          .header("access-control-allow-methods", "POST, OPTIONS")
          .header("access-control-allow-headers", "content-type")
          .code(204)
          .send();
      }
      return;
    }
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
