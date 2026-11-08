/**
 * landstrip's policy under `sandbox.allowedHosts`: the network closed but for the proxy's port,
 * and the variables that point the command's clients at it. The real boundary — landstrip denying
 * everything else — is `confinedNetworkLandstrip.test.ts`.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { describe, test } from "node:test";
import { proxyEnvironment, terminalPolicy } from "../src/terminalSandbox.ts";

const p = (...parts: string[]) => path.posix.join("/", ...parts);
const linux = { platform: "linux" as const };
const root = p("work", "app");
const tmp = p("tmp", "pi-outpost-bash-1");

describe("landstrip's policy under sandbox.allowedHosts", () => {
  test("the network is closed but for the proxy's port: no local binding, no SOCKS port, no Unix socket", () => {
    const policy = terminalPolicy({ ...linux, root, allowWrite: true, agentDir: p("srv", "agent"), tmp, networkProxy: "http://127.0.0.1:41234" });
    assert.deepEqual(policy.network, { allowNetwork: false, allowLocalBinding: false, httpProxyPort: 41234 });
    assert.equal(policy.filesystem.denyRead[0], "/", "the filesystem is confined as without a proxy");
    assert.ok(policy.filesystem.denyRead.includes(p("srv", "agent")));
  });

  test("without a proxy the network stays open, as before", () => {
    assert.deepEqual(terminalPolicy({ ...linux, root, allowWrite: true, tmp }).network, { allowNetwork: true });
  });

  test("a proxy URL without a port is refused, never read as an open network", () => {
    assert.throws(() => terminalPolicy({ ...linux, root, allowWrite: true, tmp, networkProxy: "http://127.0.0.1" }), /names no port/);
  });

  test("on Windows a proxy is refused: landstrip's AppContainer is not shown to hold it", () => {
    assert.throws(
      () => terminalPolicy({ platform: "win32", systemRoot: "C:\\Windows", root: "C:\\work\\app", allowWrite: true, tmp: "C:\\tmp\\t", networkProxy: "http://127.0.0.1:41234" }),
      /not enforced by landstrip on Windows: use MXC/,
    );
  });

  test("the proxy variables, upper and lower case, for the runners that do not set them", () => {
    const env = proxyEnvironment("http://127.0.0.1:41234");
    for (const name of ["HTTPS_PROXY", "HTTP_PROXY", "ALL_PROXY", "https_proxy", "http_proxy", "all_proxy"]) assert.equal(env[name], "http://127.0.0.1:41234", name);
    assert.equal(env.NO_PROXY, undefined, "no exception: the rest of the loopback is closed anyway");
  });
});
