/**
 * `sandbox.allowedHosts`' proxy on its own: what it relays, what it refuses and how it says
 * so. The real boundary — MXC denying everything else — is `confinedNetworkMxc.test.ts`.
 */
import assert from "node:assert/strict";
import { createServer, request, type Server } from "node:http";
import { connect } from "node:net";
import { after, before, describe, test } from "node:test";
import { hostAllowed, isAllowedHostPattern, startEgressProxy, type EgressProxy } from "../src/egressProxy.ts";

/** Sends a CONNECT for `target` and returns the proxy's status line and what came back through the tunnel. */
function tunnel(proxyPort: number, target: string, payload: string): Promise<{ status: string; body: string }> {
  return new Promise((resolve, reject) => {
    const socket = connect(proxyPort, "127.0.0.1", () => socket.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`));
    let data = "";
    let sent = false;
    socket.on("data", (chunk) => {
      data += chunk.toString();
      if (!sent && data.startsWith("HTTP/1.1 200")) {
        sent = true;
        socket.write(payload);
      }
    });
    socket.on("error", reject);
    socket.on("close", () => {
      const [head, ...rest] = data.split("\r\n\r\n");
      resolve({ status: head.split("\r\n")[0], body: rest.join("\r\n\r\n") });
    });
  });
}

describe("which hosts a list names", () => {
  test("exact names, and a suffix for the names under it — not the suffix itself, nor a lookalike", () => {
    const list = ["registry.npmjs.org", "*.githubusercontent.com"];
    assert.ok(hostAllowed("registry.npmjs.org", list));
    assert.ok(hostAllowed("REGISTRY.npmjs.org.", list), "case and a trailing dot do not matter");
    assert.ok(hostAllowed("raw.githubusercontent.com", list));
    assert.ok(!hostAllowed("githubusercontent.com", list));
    assert.ok(!hostAllowed("evilgithubusercontent.com", list));
    assert.ok(!hostAllowed("npmjs.org", list));
    assert.ok(!hostAllowed("registry.npmjs.org.evil.com", list));
  });

  test("a pattern is a name, an IPv4 address or *. and a name", () => {
    for (const ok of ["registry.npmjs.org", "*.githubusercontent.com", "localhost", "127.0.0.1"]) assert.ok(isAllowedHostPattern(ok), ok);
    for (const bad of ["", "*", "*.", "https://github.com", "github.com:443", "git hub.com", "*github.com", "a..b", "-a.com"]) {
      assert.ok(!isAllowedHostPattern(bad), JSON.stringify(bad));
    }
  });
});

describe("the proxy", () => {
  let upstream: Server;
  let upstreamPort: number;
  let proxy: EgressProxy;
  let proxyPort: number;
  const refused: string[] = [];
  const relayed: string[] = [];

  before(async () => {
    upstream = createServer((_req, res) => res.end("from-upstream"));
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    upstreamPort = (upstream.address() as { port: number }).port;
    proxy = await startEgressProxy({ allowedHosts: ["127.0.0.1"], onRefused: (line) => refused.push(line), onRelayed: (target) => relayed.push(target) });
    proxyPort = Number(new URL(proxy.url).port);
  });
  after(async () => {
    await proxy.close();
    await new Promise((resolve) => upstream.close(resolve));
  });

  test("listens on the loopback only", () => {
    assert.match(proxy.url, /^http:\/\/127\.0\.0\.1:\d+$/);
  });

  // openlore: scenario=AnAllowedHostIsReached spec=sandbox-runner-bash
  test("a listed host is relayed, on its own port", async () => {
    const { status, body } = await tunnel(proxyPort, `127.0.0.1:${upstreamPort}`, `GET / HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`);
    assert.equal(status, "HTTP/1.1 200 Connection Established");
    assert.match(body, /from-upstream/);
    assert.deepEqual(relayed, [`127.0.0.1:${upstreamPort}`]);
  });

  // openlore: scenario=AnotherHostIsRefusedWithTheReason spec=sandbox-runner-bash
  test("another host is refused with the host and the key in the status line, and logged", async () => {
    const watched: string[] = [];
    const unwatch = proxy.watchRefusals((host) => watched.push(host));
    const { status, body } = await tunnel(proxyPort, "example.com:443", "");
    unwatch();
    await tunnel(proxyPort, "other.example:443", "");
    assert.deepEqual(watched, ["example.com"], "a watcher hears the refusals while it watches, and not after");
    assert.equal(status, "HTTP/1.1 403 example.com is not in sandbox.allowedHosts");
    assert.match(body, /example\.com is not in sandbox\.allowedHosts/);
    assert.ok(refused.some((line) => /CONNECT example\.com:443/.test(line) && /sandbox\.allowedHosts/.test(line)), refused.join("\n"));
  });

  /** A plain HTTP request through the proxy, in absolute form, as curl sends one with HTTP_PROXY. */
  function viaProxy(target: string): Promise<{ code?: number; message?: string; text: string }> {
    return new Promise((resolve, reject) => {
      const req = request({ host: "127.0.0.1", port: proxyPort, path: target, method: "GET", headers: { "proxy-connection": "keep-alive" } }, (res) => {
        let text = "";
        res.on("data", (chunk) => (text += chunk));
        res.on("end", () => resolve({ code: res.statusCode, message: res.statusMessage, text }));
      });
      req.on("error", reject);
      req.end();
    });
  }

  test("plain HTTP to a listed host is relayed — a certificate authority's revocation list comes this way on Windows", async () => {
    relayed.length = 0;
    const answer = await viaProxy(`http://127.0.0.1:${upstreamPort}/crl.crl`);
    assert.equal(answer.code, 200);
    assert.equal(answer.text, "from-upstream");
    assert.deepEqual(relayed, [`127.0.0.1:${upstreamPort}`]);
  });

  test("plain HTTP to another host is refused with the host and the key, and told to a watcher", async () => {
    const watched: string[] = [];
    const unwatch = proxy.watchRefusals((host) => watched.push(host));
    const answer = await viaProxy("http://c.pki.goog/r/gsr1.crl");
    unwatch();
    assert.equal(answer.code, 403);
    assert.equal(answer.message, "c.pki.goog is not in sandbox.allowedHosts");
    assert.deepEqual(watched, ["c.pki.goog"]);
  });
});
