/**
 * Cross-origin responses: whether a browser is allowed to read what the server
 * already decided to send.
 *
 * These drive a real server over HTTP because that is the only place the answer
 * lives — the header is on the response, not in any function's return value. A
 * browser is still one step further out, and the smoke test in e2e/ covers that
 * step; what this file pins down is every case a browser would be a slow and
 * awkward way to enumerate.
 */
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { HTTP_ROUTE_CASES } from "./cors-route-cases.mjs";
import { connect, makeWorkspace, startServer } from "./harness.mjs";

const ORIGIN = "https://app.example.com";
const UNKNOWN = "https://evil.example";
const TOKEN = "test-token-cors";

describe("cross-origin responses", () => {
  let server;
  let guarded;

  before(async () => {
    const files = { "readme.md": "# workspace\n" };
    server = await startServer(await makeWorkspace(files), {
      server: { allowedOrigins: [ORIGIN] },
    });
    guarded = await startServer(await makeWorkspace(files), {
      server: { allowedOrigins: [ORIGIN], token: TOKEN },
    });
  });
  after(async () => {
    await server?.stop();
    await guarded?.stop();
  });

  // Every server has a token: authenticated, so each route answers as it does for the interface.
  const get = (path, headers = {}) => fetch(`${server.base}${path}`, { headers: { ...server.authHeaders, ...headers } });

  // openlore: {"domain":"api","requirement":"CrossOriginResponses","scenario":"AllowedOriginReadsTheResponse","specFile":"openspec/changes/add-cors-for-allowed-origins/specs/api/spec.md"}
  test("an allowed origin is echoed back, with Vary", async () => {
    const res = await get("/branding", { Origin: ORIGIN });

    assert.equal(res.headers.get("access-control-allow-origin"), ORIGIN);
    // Without Vary a shared cache can serve one origin's copy to another,
    // which undoes the decision at a layer nobody is looking at.
    assert.equal(res.headers.get("vary"), "Origin");
  });

  // openlore: {"domain":"api","requirement":"CrossOriginResponses","scenario":"EveryRouteAnswersTheSameWay","specFile":"openspec/changes/add-cors-for-allowed-origins/specs/api/spec.md"}
  test("every route answers the same way", async () => {
    // Asserted over the list rather than a favourite example: a route added
    // later should fail this test instead of quietly opting out.
    for (const { path, label } of HTTP_ROUTE_CASES) {
      const res = await get(path, { Origin: ORIGIN });
      assert.equal(res.headers.get("access-control-allow-origin"), ORIGIN, `${label} sent no allow-origin`);
    }
  });

  // openlore: {"domain":"api","requirement":"CrossOriginResponses","scenario":"UnknownOriginGetsNoHeader","specFile":"openspec/changes/add-cors-for-allowed-origins/specs/api/spec.md"}
  test("an unknown origin gets no allow-origin header and keeps the same status", async () => {
    const allowed = await get("/branding", { Origin: ORIGIN });
    const refused = await get("/branding", { Origin: UNKNOWN });

    assert.equal(refused.headers.get("access-control-allow-origin"), null);
    // The refusal is still an origin-dependent variant. If it omitted Vary, a
    // cache could reuse it for an allowed origin and break that caller's CORS.
    assert.equal(refused.headers.get("vary"), "Origin");
    // Same status as the allowed request: withholding the header already stops
    // the browser, and a different status would tell any page which origins a
    // server is configured for.
    assert.equal(refused.status, allowed.status);
  });

  // openlore: {"domain":"api","requirement":"CrossOriginResponses","scenario":"NeverAWildcard","specFile":"openspec/changes/add-cors-for-allowed-origins/specs/api/spec.md"}
  test("the allowed origin is never a wildcard", async () => {
    for (const { path, label } of HTTP_ROUTE_CASES) {
      const res = await get(path, { Origin: ORIGIN });
      assert.notEqual(res.headers.get("access-control-allow-origin"), "*", `${label} answered with a wildcard`);
    }
  });

  test("a request with no Origin gets no allow-origin header but declares the cache variant", async () => {
    // curl, a native client, the server's own health check: not a browser, so
    // there is nothing to permit and nothing to say.
    const res = await get("/branding");

    assert.equal(res.status, 200);
    assert.equal(res.headers.get("access-control-allow-origin"), null);
    assert.equal(res.headers.get("vary"), "Origin");
  });

  // openlore: {"domain":"api","requirement":"CrossOriginResponses","scenario":"LocalDevelopmentStillWorks","specFile":"openspec/changes/add-cors-for-allowed-origins/specs/api/spec.md"}
  test("a local development origin passes with an empty allowlist", async () => {
    // The configuration every contributor runs: vite on 5173, server on 3141.
    const bare = await startServer(await makeWorkspace({ "readme.md": "# x\n" }));
    try {
      const res = await fetch(`${bare.base}/branding`, { headers: { Origin: "http://localhost:5173" } });
      assert.equal(res.headers.get("access-control-allow-origin"), "http://localhost:5173");
    } finally {
      await bare.stop();
    }
  });

  test("the WebSocket still connects, hook and all", async () => {
    // The CORS hook runs on every request, and an upgrade is a request. If it
    // ever answered one, the whole application would stop working at once.
    const client = connect(server.wsUrl());
    const hello = await client.waitFor("hello", 15_000);
    assert.ok(hello.sessionId);
    client.close();
  });
});

describe("preflight", () => {
  let guarded;

  before(async () => {
    guarded = await startServer(await makeWorkspace({ "readme.md": "# x\n" }), {
      server: { allowedOrigins: [ORIGIN], token: TOKEN },
    });
  });
  after(async () => guarded?.stop());

  const preflight = (headers) =>
    fetch(`${guarded.base}/branding`, { method: "OPTIONS", headers });

  // openlore: {"domain":"api","requirement":"PreflightRequests","scenario":"PreflightForAnAuthenticatedRequest","specFile":"openspec/changes/add-cors-for-allowed-origins/specs/api/spec.md"}
  test("an authenticated request's preflight is answered", async () => {
    // Authorization is not a safelisted header, so the browser preflights every
    // call to a token-protected server. Answering the real request while
    // ignoring this would break exactly the deployments that set a token.
    const res = await preflight({
      Origin: ORIGIN,
      "Access-Control-Request-Method": "GET",
      "Access-Control-Request-Headers": "authorization",
    });

    assert.equal(res.status, 204);
    assert.equal(res.headers.get("access-control-allow-origin"), ORIGIN);
    assert.match(res.headers.get("access-control-allow-headers") ?? "", /authorization/i);
    assert.match(res.headers.get("access-control-allow-methods") ?? "", /GET/);
    assert.equal(res.headers.get("vary"), "Origin, Access-Control-Request-Headers");
  });

  // openlore: {"domain":"api","requirement":"PreflightRequests","scenario":"PreflightCarriesNoContent","specFile":"openspec/changes/add-cors-for-allowed-origins/specs/api/spec.md"}
  test("it needs no token and returns no content", async () => {
    // A preflight carries no credentials by design; requiring one would refuse
    // every authenticated cross-origin call before it was ever made.
    const res = await preflight({ Origin: ORIGIN, "Access-Control-Request-Method": "GET" });

    assert.equal(res.status, 204);
    assert.equal((await res.text()).length, 0);
  });

  test("it does not run the route it asks about", async () => {
    // /files/raw would read a file; a preflight must not.
    const res = await fetch(`${guarded.base}/files/raw?path=readme.md`, {
      method: "OPTIONS",
      headers: { Origin: ORIGIN, "Access-Control-Request-Method": "GET" },
    });

    assert.equal(res.status, 204);
    assert.equal((await res.text()).length, 0);
  });

  // openlore: {"domain":"api","requirement":"PreflightRequests","scenario":"PreflightFromAnUnknownOrigin","specFile":"openspec/changes/add-cors-for-allowed-origins/specs/api/spec.md"}
  test("an unknown origin's preflight is refused and told nothing", async () => {
    const res = await preflight({ Origin: UNKNOWN, "Access-Control-Request-Method": "GET" });

    assert.equal(res.headers.get("access-control-allow-origin"), null);
    assert.equal(res.headers.get("access-control-allow-methods"), null);
  });

  test("its answer is cached briefly, not indefinitely", async () => {
    // A long cache means a corrected allowedOrigins keeps being ignored by every
    // browser that already asked.
    const res = await preflight({ Origin: ORIGIN, "Access-Control-Request-Method": "GET" });
    const maxAge = Number(res.headers.get("access-control-max-age"));

    assert.ok(Number.isInteger(maxAge) && maxAge > 0, `expected a positive max-age, got ${maxAge}`);
    assert.ok(maxAge <= 600, `${maxAge}s is long enough to outlive a configuration fix`);
  });
});

describe("cross-origin grants no authority", () => {
  let guarded;

  before(async () => {
    guarded = await startServer(await makeWorkspace({ "readme.md": "# x\n" }), {
      server: { allowedOrigins: [ORIGIN], token: TOKEN },
    });
  });
  after(async () => guarded?.stop());

  test("a token-protected route still refuses without a token", async () => {
    const res = await fetch(`${guarded.base}/branding`, { headers: { Origin: ORIGIN } });

    assert.equal(res.status, 401);
    // And the refusal carries the header: a browser that cannot read the 401
    // cannot tell "refused" from "unreachable", and the client shows the wrong
    // thing to the user.
    assert.equal(res.headers.get("access-control-allow-origin"), ORIGIN);
  });

  test("a valid token still works from an allowed origin", async () => {
    const res = await fetch(`${guarded.base}/branding`, {
      headers: { Origin: ORIGIN, Authorization: `Bearer ${TOKEN}` },
    });

    assert.equal(res.status, 200);
    assert.equal(res.headers.get("access-control-allow-origin"), ORIGIN);
  });

  test("path confinement is unchanged", async () => {
    const res = await fetch(`${guarded.base}/files/raw?path=../secret.txt`, {
      headers: { Origin: ORIGIN, Authorization: `Bearer ${TOKEN}` },
    });

    assert.ok(res.status >= 400, `expected a refusal, got ${res.status}`);
  });
});
