/**
 * The harness hands a test its own server, never another one answering on the same port.
 *
 * `freePort()` closes the port it found before the server binds it. Test files run in
 * parallel processes, so under load another file's server can take that port first. Our
 * child then dies at bind — but while it is still booting, `/health` on the port is
 * answered by the other server, and the harness used to take that answer as its own: the
 * test then drove another test's server. On CI that read as a collection enrollment
 * refused with "Session change already in progress" (the other test was changing its
 * session) and a socket closed under the next test (the other test stopped its server).
 *
 * Here the other server is a stub that answers `/health` like a ready pi-outpost.
 */
import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";
import { makeWorkspace, startServer } from "./harness.mjs";

test("a port another server holds is not taken for this test's server", async () => {
  const impostor = http.createServer((req, res) => {
    res.writeHead(req.url === "/health" ? 200 : 404, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, sessionId: "someone-else" }));
  });
  await new Promise((resolve) => impostor.listen(0, "127.0.0.1", resolve));
  const { port } = impostor.address();
  let server;
  try {
    const root = await makeWorkspace();
    // A port the test names is kept (no retry), so the outcome is visible here: the
    // server cannot bind it, and the harness must say so rather than return.
    await assert.rejects(
      (async () => {
        server = await startServer(root, { server: { port } });
      })(),
      /EADDRINUSE|already in use/,
    );
  } finally {
    await server?.stop();
    await new Promise((resolve) => impostor.close(resolve));
  }
});

test("a server the harness chose is its own: its log has the session it reports", async () => {
  const server = await startServer(await makeWorkspace());
  try {
    const health = await (await fetch(`${server.base}/health`)).json();
    assert.ok(server.log().includes(`[pi] session ${health.sessionId}`));
  } finally {
    await server.stop();
  }
});
