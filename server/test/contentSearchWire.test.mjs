/** Content search (Files → Search in files) over the real WebSocket boundary. */
import assert from "node:assert/strict";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { connect, makeWorkspace, startServer } from "./harness.mjs";

describe("content search over the socket", () => {
  let root;
  let outside;
  let server;
  let client;
  let requestCounter = 0;

  before(async () => {
    const files = {
      "notes/plan.md": "# Plan\nship the haystack search\n",
      "src/app.ts": "export const label = 'HAYSTACK';\n",
    };
    // Enough files that a search is still walking when the next message arrives.
    for (let i = 0; i < 400; i++) files[`bulk/file-${i}.txt`] = `filler ${i}\nslow-needle ${i}\n`;
    root = await makeWorkspace(files);
    outside = await mkdtemp(path.join(tmpdir(), "pi-outpost-outside-"));
    await writeFile(path.join(outside, "secret.txt"), "haystack beyond the root\n");
    // A link out of the root, where the platform lets us make one.
    await symlink(path.join(outside, "secret.txt"), path.join(root, "escape.txt")).catch(() => {});
    server = await startServer(root, { sandbox: { root, allowWrite: false, allowBash: false } });
    client = connect(server.wsUrl());
    await client.waitFor("hello");
  });

  after(async () => {
    client?.close();
    await server?.stop();
    await rm(outside, { recursive: true, force: true });
  });

  function searchFor(query) {
    const requestId = `content-${++requestCounter}`;
    client.send({ type: "search_content", query, requestId });
    return requestId;
  }

  test("answers the files under its root that hold the query, and nothing outside it", async () => {
    const requestId = searchFor("haystack");
    const reply = await client.waitFor((message) => message.type === "content_search_results" && message.requestId === requestId, 20_000);

    assert.equal(reply.query, "haystack");
    assert.equal(reply.truncated, false);
    assert.deepEqual(
      reply.hits.map((hit) => [hit.path, hit.line]),
      [
        ["notes/plan.md", 2],
        ["src/app.ts", 1],
      ],
    );
    assert.ok(reply.hits.every((hit) => !hit.excerpt.includes("beyond the root")));
  });

  test("an empty query answers no hits", async () => {
    const requestId = searchFor("   ");
    const reply = await client.waitFor((message) => message.type === "content_search_results" && message.requestId === requestId, 20_000);
    assert.deepEqual(reply.hits, []);
  });

  test("a search superseded by a newer one is never answered", async () => {
    const first = searchFor("slow-needle");
    const second = searchFor("haystack");
    await client.waitFor((message) => message.type === "content_search_results" && message.requestId === second, 20_000);
    // The first was aborted, not merely overtaken: give a late answer the time to show.
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.equal(client.received.some((message) => message.requestId === first), false);
  });
});
