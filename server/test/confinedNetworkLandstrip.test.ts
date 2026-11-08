/**
 * The agent's `bash` under the real landstrip runner on Linux, with the network open or held to
 * `sandbox.allowedHosts`.
 *
 * Runs where `LANDSTRIP_BIN` names the runner: CI's Linux job. Every check is made from the
 * command's side: the listed host through the server's proxy, an unlisted one refused with the
 * note, the listed one again around the proxy, and services of the host on the loopback — on
 * `127.0.0.1`, another `127.x`, `[::1]` and a Unix socket — that a command must not reach.
 */
import assert from "node:assert/strict";
import { lookup } from "node:dns/promises";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { confinedBashOperations } from "../src/confinedBash.ts";
import { startEgressProxy, type EgressProxy } from "../src/egressProxy.ts";
import { checkRunner } from "../src/terminalSandbox.ts";

const RUNNER = process.env.LANDSTRIP_BIN;
const skip = process.platform !== "linux" ? "landstrip holds the network on Linux only" : !RUNNER ? "LANDSTRIP_BIN is not set (CI's Linux job sets it)" : false;

/** An HTTP server answering `body`, listening where `listen` says. */
async function service(body: string, listen: (server: Server, ready: () => void) => void): Promise<Server> {
  const server = createServer((_req, res) => res.end(body));
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    listen(server, () => resolve());
  });
  return server;
}

describe("the agent's bash under landstrip, the network", { skip }, () => {
  let base: string;
  let root: string;
  let proxy: EgressProxy;
  const relayed: string[] = [];
  const services: Server[] = [];
  let port = 0;
  let ipv6 = false;
  let online = false;
  let socketPath: string;

  before(async () => {
    const check = await checkRunner(RUNNER!);
    assert.ok(check.ok, `landstrip cannot confine here: ${check.ok ? "" : check.reason}`);
    base = await mkdtemp(path.join(tmpdir(), "landstrip-net-"));
    root = path.join(base, "app");
    await mkdir(root);
    online = await lookup("registry.npmjs.org").then(() => true, () => false);
    proxy = await startEgressProxy({ allowedHosts: ["registry.npmjs.org"], onRefused: () => {}, onRelayed: (target) => relayed.push(target) });
    // One port number, other than the proxy's, served on every loopback address that exists here.
    const first = await service("svc-127-0-0-1", (s, ready) => s.listen(0, "127.0.0.1", ready));
    services.push(first);
    port = (first.address() as { port: number }).port;
    services.push(await service("svc-127-0-0-2", (s, ready) => s.listen(port, "127.0.0.2", ready)));
    try {
      services.push(await service("svc-ipv6", (s, ready) => s.listen({ port, host: "::1", ipv6Only: true }, ready)));
      ipv6 = true;
    } catch {
      // No IPv6 loopback: nothing of the host can listen there either.
    }
    // A Unix socket inside the root: readable as a file, and still no way out.
    socketPath = path.join(root, "svc.sock");
    services.push(await service("svc-unix", (s, ready) => s.listen(socketPath, ready)));
  });
  after(async () => {
    await proxy?.close();
    await Promise.all(services.map((s) => new Promise((resolve) => s.close(resolve))));
    if (base) await rm(base, { recursive: true, force: true });
  });

  async function bash(command: string, networkProxy?: EgressProxy) {
    const ops = confinedBashOperations({ runner: RUNNER!, root, allowWrite: true, agentDir: path.join(base, "agent"), ...(networkProxy ? { networkProxy } : {}) });
    let output = "";
    const { exitCode } = await ops.exec(command, root, { onData: (data) => (output += data.toString()) });
    return { output, exitCode };
  }

  // openlore: scenario=UnderLandstripWithoutAnAllowlistTheNetworkIsOpen spec=sandbox-runner-bash
  test("UnderLandstripWithoutAnAllowlistTheNetworkIsOpen: a public host is reached, no proxy variable is set", async (t) => {
    if (!online) return t.skip("this host does not reach registry.npmjs.org");
    const result = await bash([`echo "open=$(curl -sS -o /dev/null -m 20 -w '%{http_code}' https://registry.npmjs.org/)"`, `echo "proxies=$(env | grep -ci '_proxy=')"`].join("\n"));
    assert.match(result.output, /open=200/, result.output);
    assert.match(result.output, /proxies=0/, result.output);
  });

  // openlore: scenario=UnderLandstripAnAllowedHostIsReachedAndOthersAreRefused spec=sandbox-runner-bash
  test("UnderLandstripAnAllowedHostIsReachedAndOthersAreRefused: the listed host through the proxy, nothing else", async (t) => {
    if (!online) return t.skip("this host does not reach registry.npmjs.org");
    relayed.length = 0;
    const result = await bash(
      [
        `echo "allowed=$(curl -s -o /dev/null -m 20 -w '%{http_code}' https://registry.npmjs.org/)"`,
        `curl -sS -o /dev/null -m 20 https://example.com/; echo "unlisted=$?"`,
        `curl -s -o /dev/null -m 10 --noproxy '*' https://registry.npmjs.org/; echo "direct=$?"`,
        `curl -s -m 10 --noproxy '*' http://127.0.0.1:${port}/; echo " loopback=$?"`,
      ].join("\n"),
      proxy,
    );
    assert.match(result.output, /allowed=200/, result.output);
    assert.match(result.output, /unlisted=(?!0\b)\d+/, result.output);
    assert.match(result.output, /direct=(?!0\b)\d+/, `a direct connection went out: ${result.output}`);
    assert.match(result.output, /loopback=(?!0\b)\d+/, result.output);
    assert.doesNotMatch(result.output, /svc-127-0-0-1/, "another service on the loopback was reached");
    assert.match(result.output, /\[pi-outpost\] network refused: example\.com — not in sandbox\.allowedHosts\.[^\n]*\s*$/, result.output);
    assert.ok(relayed.includes("registry.npmjs.org:443"), `not through the proxy: ${relayed.join(", ")}`);
  });

  // openlore: scenario=UnderLandstripNoOtherLoopbackAddressReachesAService spec=sandbox-runner-bash
  test("UnderLandstripNoOtherLoopbackAddressReachesAService: 127.0.0.1, 127.0.0.2, [::1], a Unix socket and a listener are all refused", async () => {
    const result = await bash(
      [
        `curl -s -m 5 --noproxy '*' http://127.0.0.1:${port}/; echo " v4=$?"`,
        `curl -s -m 5 --noproxy '*' http://127.0.0.2:${port}/; echo " v4b=$?"`,
        ...(ipv6 ? [`curl -s -m 5 --noproxy '*' 'http://[::1]:${port}/'; echo " v6=$?"`] : []),
        `curl -s -m 5 --noproxy '*' --unix-socket ${JSON.stringify(socketPath)} http://local/; echo " unix=$?"`,
        `python3 -c "import socket; s=socket.socket(); s.bind(('127.0.0.1', 0)); s.listen(); print('listening')" 2>/dev/null; echo " listen=$?"`,
      ].join("\n"),
      proxy,
    );
    assert.doesNotMatch(result.output, /svc-/, `a service of the host was reached: ${result.output}`);
    for (const probe of ["v4", "v4b", ...(ipv6 ? ["v6"] : []), "unix", "listen"]) assert.match(result.output, new RegExp(`\\b${probe}=(?!0\\b)\\d+`), `${probe}: ${result.output}`);
    assert.doesNotMatch(result.output, /^listening$/m, "a command opened a listening socket");
    // The proxy's own port is reachable on [::1] too, and it is the proxy that answers there.
    if (ipv6) {
      const proxyPort = new URL(proxy.url).port;
      const own = await bash(`echo "own6=$(curl -s -o /dev/null -m 10 -w '%{http_code}' -x 'http://[::1]:${proxyPort}' http://example.invalid/)"`, proxy);
      assert.match(own.output, /own6=403/, own.output);
    }
  });
});
