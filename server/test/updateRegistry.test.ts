/**
 * The registry asked directly, as a self-contained executable does on a host without npm,
 * and what each answer becomes once fetchPublishedVersion has read it.
 *
 * The registry is a local HTTP server that records what it was asked, so the request
 * itself — path, encoded package name, version, accept header — is checked, not only the
 * answer. Nothing here reaches the network.
 */
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, test } from "node:test";
import { directRegistryLatestVersion, fetchPublishedVersion } from "../src/update.ts";

interface Seen {
  url: string;
  accept: string | undefined;
}

/** What the registry answers for the next request, and every request it was sent. */
let reply: (response: http.ServerResponse) => void = (response) => response.end();
const seen: Seen[] = [];
let server: http.Server;
let registry: string;

before(async () => {
  server = http.createServer((request, response) => {
    seen.push({ url: request.url ?? "", accept: request.headers.accept });
    reply(response);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  registry = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server.closeAllConnections();
  server.close();
});

const json = (status: number, body: string) => (response: http.ServerResponse) => {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(body);
};

const lookup = (options: { registry?: string; packageName?: string; version?: string; background?: boolean }) =>
  directRegistryLatestVersion({ signal: AbortSignal.timeout(5_000), background: false, ...options });

describe("asking the registry directly", () => {
  test("asks for the package's latest version as JSON and returns the version it names", async () => {
    reply = json(200, JSON.stringify({ name: "pi-outpost", version: "9.8.7" }));
    seen.length = 0;
    assert.equal(await lookup({ registry }), "9.8.7");
    assert.deepEqual(seen, [{ url: "/pi-outpost/latest", accept: "application/json" }]);
  });

  test("a scoped name keeps its slash encoded, an exact version is asked for as such, and trailing slashes on the registry are dropped", async () => {
    reply = json(200, JSON.stringify({ version: "1.5.2" }));
    seen.length = 0;
    assert.equal(await lookup({ registry: `${registry}///`, packageName: "@earendil-works/pi-mcp", version: "1.5.2" }), "1.5.2");
    assert.deepEqual(seen.map((request) => request.url), ["/@earendil-works%2Fpi-mcp/1.5.2"]);
  });

  test("without a registry option it uses npm_config_registry", async () => {
    reply = json(200, JSON.stringify({ version: "2.0.0" }));
    seen.length = 0;
    const previous = process.env.npm_config_registry;
    process.env.npm_config_registry = `  ${registry}/  `;
    try {
      assert.equal(await lookup({}), "2.0.0");
    } finally {
      if (previous === undefined) delete process.env.npm_config_registry;
      else process.env.npm_config_registry = previous;
    }
    assert.equal(seen.length, 1, "the configured registry was the one asked");
  });

  test("a name or version that is not one is refused before any request", async () => {
    seen.length = 0;
    await assert.rejects(lookup({ registry, packageName: "../etc/passwd" }), /is not an npm package name/);
    await assert.rejects(lookup({ registry, version: "^1.0.0" }), /is not an exact version/);
    assert.equal(seen.length, 0);
  });

  test("a non-2xx answer and a body that is not JSON are errors, naming which", async () => {
    reply = json(503, "{}");
    await assert.rejects(lookup({ registry }), /the registry answered 503/);
    reply = json(200, "<html>a captive portal</html>");
    await assert.rejects(lookup({ registry }), /the registry answered without JSON/);
  });

  test("a background lookup still answers", async () => {
    reply = json(200, JSON.stringify({ version: "3.1.4" }));
    assert.equal(await lookup({ registry, background: true }), "3.1.4");
  });
});

describe("what fetchPublishedVersion makes of the registry's answer", () => {
  const published = (options: { timeoutMs?: number } = {}) =>
    fetchPublishedVersion("pi-outpost", undefined, { lookupImpl: directRegistryLatestVersion, registry, ...options });

  test("a version is found", async () => {
    reply = json(200, JSON.stringify({ version: "4.0.0" }));
    assert.deepEqual(await published(), { status: "found", version: "4.0.0" });
  });

  test("a 404 means the registry has no such thing, not that the check failed", async () => {
    reply = json(404, JSON.stringify({ error: "Not found" }));
    assert.deepEqual(await published(), { status: "missing" });
  });

  test("an answer without a version string is a failed check, not a version", async () => {
    reply = json(200, JSON.stringify({ version: 4 }));
    assert.deepEqual(await published(), { status: "failed", reason: "npm answered without a version" });
    reply = json(200, JSON.stringify({ name: "pi-outpost" }));
    assert.deepEqual(await published(), { status: "missing" }, "no version field: the registry has none to give");
  });

  test("a server error is a failed check that says what the registry answered", async () => {
    reply = json(500, "{}");
    assert.deepEqual(await published(), { status: "failed", reason: "the registry answered 500" });
  });

  test("a registry that never answers is a failed check after the timeout", async () => {
    reply = () => {
      // Accept the request and never answer it.
    };
    assert.deepEqual(await published({ timeoutMs: 150 }), { status: "failed", reason: "no answer within 150 ms" });
  });
});
