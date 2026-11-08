import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import https from "node:https";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { connect, makeWorkspace, startServer } from "./harness.mjs";

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "tls");
const certFile = path.join(fixtures, "test-cert.pem");
const keyFile = path.join(fixtures, "test-key.pem");
const ca = await readFile(certFile);
const token = "tls-integration-test-token";
let server;

function get(url, options = {}, transport = https) {
  return new Promise((resolve, reject) => {
    const request = transport.get(url, { ca, timeout: 3000, ...options }, (response) => {
      let body = "";
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => resolve({ status: response.statusCode, body, protocol: response.socket?.getProtocol?.() }));
    });
    request.on("timeout", () => request.destroy(new Error("request timed out")));
    request.on("error", reject);
  });
}

before(async () => {
  server = await startServer(await makeWorkspace(), {
    server: { host: "0.0.0.0", token, tls: { certFile, keyFile } }, updateCheck: false,
  }, { ca });
});
after(async () => { await server?.stop(); });

test("HttpsAndWss", async () => {
  const health = await get(`${server.base}/health`);
  assert.equal(health.status, 200);
  assert.equal(JSON.parse(health.body).sessionId, undefined);
  assert.equal((await get(`${server.base}/branding`)).status, 401);
  assert.equal((await get(`${server.base}/branding`, { headers: { authorization: `Bearer ${token}` } })).status, 200);
  const client = connect(server.wsUrl(token), { ca, origin: server.base });
  try {
    await client.open();
    assert.ok((await client.waitFor("hello", 15000)).sessionId);
    assert.match(client.ws._socket.getProtocol(), /^TLSv1\.[23]$/);
  } finally { client.close(); }
  for (const supplied of [undefined, "wrong"]) {
    const denied = connect(server.wsUrl(supplied), { ca });
    assert.equal(await denied.waitForClose(), 4401);
    assert.deepEqual(denied.received, []);
  }
  const forbidden = connect(server.wsUrl(token), { ca, origin: "https://untrusted.example" });
  assert.equal(await forbidden.waitForClose(), 1008);
  assert.deepEqual(forbidden.received, []);
  await assert.rejects(get(`${server.base}/health`, { maxVersion: "TLSv1.1", minVersion: "TLSv1" }));
  await assert.rejects(get(`${server.base}/health`, { ca: undefined }), /self.signed|certificate/i);
  await assert.rejects(get(`${server.base}/health`, { servername: "wrong.example" }), /hostname|altnames/i);
  assert.match(server.log(), /\[server\] https:\/\//);
});

test("NoPlaintextFallback", async () => {
  await assert.rejects(get(`http://127.0.0.1:${server.port}/branding`, { headers: { authorization: `Bearer ${token}` } }, http));
});

test("RemoteHttpRefused before any HTTP listener exists", async () => {
  const root = await makeWorkspace();
  try {
    await assert.rejects(startServer(root, { server: { host: "0.0.0.0", token } }), /refusing unencrypted HTTP/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("ProtectedHopOptIn", async () => {
  const hop = await startServer(await makeWorkspace(), {
    server: { host: "0.0.0.0", token, allowInsecureHttp: true }, updateCheck: false,
  });
  try {
    assert.match(hop.log(), /HTTP is explicitly enabled.*unencrypted/);
    const response = await fetch(`${hop.base}/branding`, { headers: { "x-forwarded-proto": "https" } });
    assert.equal(response.status, 401);
    const client = connect(hop.wsUrl(token));
    try { assert.ok((await client.waitFor("hello", 15000)).sessionId); }
    finally { client.close(); }
  } finally { await hop.stop(); }
});

test("InvalidTlsFailsClosed at startup even when HTTP was explicitly allowed", async () => {
  for (const certificate of ["missing-cert.pem", "expired-cert.pem", "future-cert.pem", "test-key.pem"]) {
    const root = await makeWorkspace();
    try {
      await assert.rejects(startServer(root, {
        server: { host: "0.0.0.0", token, allowInsecureHttp: true, tls: { certFile: path.join(fixtures, certificate), keyFile } },
      }, { ca }), (error) => {
        assert.match(error.message, /server.tls/);
        assert.doesNotMatch(error.message, /BEGIN.*PRIVATE KEY/);
        assert.doesNotMatch(error.message, /\[server\] http:/);
        return true;
      });
    } finally { await rm(root, { recursive: true, force: true }); }
  }
});
