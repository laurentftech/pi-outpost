/**
 * A connection the sandbox refused, told apart from a network failure (issues #552, #554); and the
 * user's own proxy variables, handed to a command whose network is open — never one carrying a
 * password.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { reportsSocketRefused, socketRefusedNote } from "../src/confinedBash.ts";
import { networkSummary } from "../src/sandbox.ts";
import { confinedEnvironment, proxyCredentialsLeftOut, userProxyEnvironment } from "../src/terminalSandbox.ts";

describe("reportsSocketRefused", () => {
  // openlore: scenario=ASandboxRefusalIsNamed spec=sandbox-runner-bash
  test("ASandboxRefusalIsNamed: WSAEACCES, as programs word it, is recognised; other failures are not", () => {
    for (const output of [
      "Caused by: A socket operation was attempted on an inaccessible address (os error 10013)", // uv, Rust
      "PermissionError: [WinError 10013] An attempt was made to access a socket in a way forbidden by its access permissions", // Python
      "Une tentative d’accès à un socket de manière interdite par ses autorisations d’accès a été tentée", // .NET, French
      "connect: WSAEACCES",
    ]) {
      assert.equal(reportsSocketRefused(output), true, output);
    }
    for (const output of [
      "listening on port 10013",
      "getaddrinfo ENOTFOUND example.com",
      "A connection attempt failed because the connected party did not properly respond (os error 10060)",
      "Access is denied. (os error 5)",
    ]) {
      assert.equal(reportsSocketRefused(output), false, output);
    }
  });

  test("under the list's proxy a direct connection's 'network unreachable' (10051) is the sandbox's too; with the network open, it is the network's", () => {
    // Python's create_connection to pypi.org, measured under MXC with sandbox.allowedHosts, on a French machine.
    const python = "OSError: [WinError 10051] Une opération a été tentée sur un réseau impossible à atteindre";
    assert.equal(reportsSocketRefused(python, true), true);
    assert.equal(reportsSocketRefused("Caused by: A socket operation was attempted to an unreachable network. (os error 10051)", true), true);
    assert.equal(reportsSocketRefused(python, false), false);
    assert.match(socketRefusedNote({ proxy: true, hostLoopback: true, privateNetwork: true }), /\(a direct one: no route but the proxy\)/);
  });

  test("the note says it was the sandbox, not to retry, and what this sandbox opens", () => {
    const open = socketRefusedNote({ proxy: false, hostLoopback: true, privateNetwork: true });
    assert.match(open, /the sandbox refused a network connection \(WSAEACCES, 10013\)/);
    assert.match(open, /not a network failure, and retrying will not help/);
    const closed = socketRefusedNote({ proxy: false, hostLoopback: true, privateNetwork: false });
    assert.match(closed, /the private network is closed \(sandbox\.privateNetwork is false\)/);
    assert.match(socketRefusedNote({ proxy: false, hostLoopback: false, privateNetwork: true }), /sandbox\.hostLoopback is false/);
    assert.match(socketRefusedNote({ proxy: true, hostLoopback: true, privateNetwork: true }), /only through the proxy named in HTTPS_PROXY/);
  });
});

describe("the user's proxy variables", () => {
  const env = {
    HTTPS_PROXY: "http://proxy.corp.example:8080",
    http_proxy: "http://alice:s3cret@proxy.corp.example:8080",
    NO_PROXY: "localhost,.corp.example",
    ALL_PROXY: "",
    OPENAI_API_KEY: "sk-x",
  };

  // openlore: scenario=TheCompanyProxyReachesTheCommand spec=sandbox-runner-bash
  test("TheCompanyProxyReachesTheCommand: passed when the network is open, a proxy with credentials never", () => {
    assert.deepEqual(userProxyEnvironment(env), { HTTPS_PROXY: "http://proxy.corp.example:8080", NO_PROXY: "localhost,.corp.example" });
    assert.deepEqual(userProxyEnvironment({ HTTP_PROXY: "bob:pw@10.0.0.2:3128" }), {}, "credentials without a scheme are seen too");
    assert.deepEqual(proxyCredentialsLeftOut(env), ["http_proxy"]);

    const base = { root: "C:\\work\\app", tmp: "C:\\t\\b", shell: "powershell.exe", platform: "win32" as const };
    const passed = confinedEnvironment(env, { ...base, userProxy: true });
    assert.equal(passed.HTTPS_PROXY, "http://proxy.corp.example:8080");
    assert.equal(passed.NO_PROXY, "localhost,.corp.example");
    assert.equal(passed.http_proxy, undefined);
    assert.equal(passed.OPENAI_API_KEY, undefined);
    // Under sandbox.allowedHosts the server's proxy is the only way out: none of the user's.
    const held = confinedEnvironment(env, base);
    assert.equal(held.HTTPS_PROXY, undefined);
    assert.equal(held.NO_PROXY, undefined);
  });

  test("the startup line names a proxy variable left out for its credentials, and nothing otherwise", () => {
    const sandbox = { allowWrite: true, allowBash: true, bashRunner: "mxc" } as never;
    assert.match(networkSummary(sandbox, "linux", [], env) ?? "", /^http_proxy left out: a proxy with credentials is not handed to commands/);
    assert.equal(networkSummary(sandbox, "linux", [], { HTTPS_PROXY: "http://proxy:8080" }), undefined);
    assert.equal(networkSummary({ ...(sandbox as object), allowedHosts: ["pypi.org"], grants: "never" } as never, "linux", [], env), "network only to pypi.org", "under the list's proxy the user's is not handed over anyway");
  });
});
