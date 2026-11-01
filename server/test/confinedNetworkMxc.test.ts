/**
 * `sandbox.allowedHosts` under MXC's real executor (Windows 11, tier 1): the agent's
 * `powershell` with outbound traffic denied and pi-outpost's proxy as its only way out.
 *
 * Checked from the command's side: an allowed host answers through the proxy (curl, git,
 * Windows PowerShell's own cmdlet), another is refused with the reason, and nothing goes
 * around the proxy — not a direct connection, not another service on the host's loopback.
 *
 * Only where `MXC_EXEC` names the executor, and where the host itself reaches
 * registry.npmjs.org and github.com: no CI runner has MXC tier 1.
 */
import assert from "node:assert/strict";
import { lookup } from "node:dns/promises";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { confinedBashOperations } from "../src/confinedBash.ts";
import { startEgressProxy, type EgressProxy } from "../src/egressProxy.ts";

const RUNNER = process.env.MXC_EXEC;
const POWERSHELL = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
const online = await lookup("registry.npmjs.org").then(() => true, () => false);
const skip =
  process.platform !== "win32"
    ? "MXC confines on Windows only"
    : !RUNNER
      ? "MXC_EXEC (wxc-exec.exe) is not set"
      : !online
        ? "this host does not reach registry.npmjs.org"
        : false;

describe("the agent's powershell under MXC, network only to allowed hosts", { skip }, () => {
  let base: string;
  let root: string;
  let proxy: EgressProxy;
  let other: Server;
  let otherPort: number;
  const refused: string[] = [];
  const relayed: string[] = [];

  before(async () => {
    base = await mkdtemp(path.join(tmpdir(), "confined-network-mxc-"));
    root = path.join(base, "app");
    await mkdir(path.join(base, "agent"), { recursive: true });
    await mkdir(root);
    execFileSync("git", ["init", "-q", root]);
    proxy = await startEgressProxy({
      // registry.npmjs.org's certificate authority: Schannel (curl.exe) fetches its revocation list over plain HTTP.
      allowedHosts: ["registry.npmjs.org", "github.com", "*.pki.goog"],
      onRefused: (line) => refused.push(line),
      onRelayed: (target) => relayed.push(target),
    });
    // A service of the host's own, listening on its loopback beside the proxy.
    other = createServer((_req, res) => res.end("other-local-service"));
    await new Promise<void>((resolve) => other.listen(0, "127.0.0.1", resolve));
    otherPort = (other.address() as { port: number }).port;
  });

  after(async () => {
    await proxy?.close();
    await new Promise((resolve) => (other ? other.close(resolve) : resolve(undefined)));
    if (base) await rm(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });

  async function ps(command: string) {
    const ops = confinedBashOperations({
      runner: RUNNER!,
      shell: POWERSHELL,
      root,
      allowWrite: true,
      agentDir: path.join(base, "agent"),
      networkProxy: proxy,
    });
    let output = "";
    const { exitCode } = await ops.exec(command, root, { onData: (data) => (output += data.toString()) });
    return { output, exitCode };
  }

  // openlore: scenario=AnAllowedHostIsReached spec=sandbox-runner-bash
  test("AnAllowedHostIsReached: curl and git reach the allowed hosts, through the proxy", { timeout: 120_000 }, async () => {
    relayed.length = 0;
    const result = await ps(
      "'curl=' + (curl.exe -s -o NUL -m 20 -w '%{http_code}' https://registry.npmjs.org/); " +
        "git ls-remote https://github.com/laurentftech/pi-outpost HEAD",
    );
    assert.match(result.output, /curl=200/, result.output);
    assert.match(result.output, /^[0-9a-f]{40}\tHEAD/m, `git did not reach github.com: ${result.output}`);
    assert.doesNotMatch(result.output, /\[pi-outpost\] network refused/, "nothing was refused, so nothing is noted");
    // Exact targets, compared as a set: not a search through URLs.
    const through = new Set(relayed);
    assert.ok(through.has("registry.npmjs.org:443") && through.has("github.com:443"), `not through the proxy: ${relayed.join(", ")}`);
  });

  // openlore: scenario=PowerShellFetchesThroughTheProxy spec=sandbox-runner-bash
  test("PowerShellFetchesThroughTheProxy: Invoke-WebRequest, naming no proxy, reaches an allowed host", { timeout: 120_000 }, async () => {
    const result = await ps("'status=' + (Invoke-WebRequest -UseBasicParsing -Uri https://registry.npmjs.org/ -TimeoutSec 20).StatusCode");
    assert.equal(result.exitCode, 0, result.output);
    assert.match(result.output, /status=200/, result.output);
    // Without the switch, Windows PowerShell reached for Internet Explorer's engine and failed "not in interactive mode".
    const plain = await ps("'plain=' + (Invoke-WebRequest -Uri https://registry.npmjs.org/ -TimeoutSec 20).StatusCode");
    assert.equal(plain.exitCode, 0, plain.output);
    assert.match(plain.output, /plain=200/, plain.output);
  });

  // openlore: scenario=AnotherHostIsRefusedWithTheReason spec=sandbox-runner-bash
  test("AnotherHostIsRefusedWithTheReason: an unlisted host fails, the output ends naming it and the key, the server logs it", { timeout: 120_000 }, async () => {
    refused.length = 0;
    const result = await ps("curl.exe -sS -m 20 https://example.com/; 'curl exit=' + $LASTEXITCODE; curl.exe -s -v -m 20 https://example.com/ 2>&1 | Select-String '< HTTP'");
    assert.doesNotMatch(result.output, /curl exit=0\b/, result.output);
    // What curl itself shows is "response 403": the note after the output is what names the host.
    assert.match(result.output, /\[pi-outpost\] network refused: example\.com — not in sandbox\.allowedHosts\.[^\n]*\s*$/, `no note naming the host ends the output: ${result.output}`);
    assert.match(result.output, /< HTTP\/1\.1 403 example\.com is not in sandbox\.allowedHosts/, `the proxy's own answer does not name it: ${result.output}`);
    assert.ok(refused.some((line) => /^\[sandbox\] network: refused CONNECT example\.com:443 — example\.com is not in sandbox\.allowedHosts$/.test(line)), refused.join("\n"));
  });

  describe("a connection to an unlisted host, asked about while it waits", () => {
    const status = "'curl=' + (curl.exe -s -o NUL -m 20 --ssl-no-revoke -w '%{http_code}' https://example.com/)";
    async function run(command: string, extra: Partial<Parameters<typeof confinedBashOperations>[0]> = {}) {
      const ops = confinedBashOperations({
        runner: RUNNER!,
        shell: POWERSHELL,
        root,
        allowWrite: true,
        agentDir: path.join(base, "agent"),
        networkProxy: proxy,
        allowedHosts: ["registry.npmjs.org", "github.com", "*.pki.goog"],
        ...extra,
      });
      let output = "";
      await ops.exec(command, root, { onData: (data: Buffer) => (output += data.toString()) });
      return output;
    }

    // openlore: scenario=AConnectionToAnUnlistedHostWaitsForTheUser spec=sandbox-approved-grants
    test("allowed for the command: the connection goes through after the answer, and the note says who allowed it", { timeout: 120_000 }, async () => {
      const asked: string[] = [];
      const output = await run(status, {
        askHost: async ({ host }) => {
          asked.push(host);
          await new Promise((resolve) => setTimeout(resolve, 1500));
          return "approved-once";
        },
      });
      assert.match(output, /curl=200/, output);
      assert.deepEqual(asked, ["example.com"]);
      assert.match(output, /\[pi-outpost\] network: the user allowed example\.com for this command\.\s*$/, output);
    });

    // openlore: scenario=ARefusedConnectionFailsAndSaysWhy spec=sandbox-approved-grants
    test("refused: the connection is refused with the user's answer, and the note says not to retry", { timeout: 120_000 }, async () => {
      const output = await run(`${status}; curl.exe -s -v -m 20 --ssl-no-revoke https://example.com/ 2>&1 | Select-String '< HTTP'`, { askHost: async () => "refused" });
      assert.doesNotMatch(output, /curl=200/, output);
      assert.match(output, /< HTTP\/1\.1 403 the user refused example\.com/, output);
      assert.match(output, /\[pi-outpost\] network: the user refused example\.com\.\n\[pi-outpost\] Do not retry a refused host for this request: tell the user what it blocked\.\s*$/, output);
    });

    test("a command that never connects is never asked about: opening the user's browser asks nothing", { timeout: 120_000 }, async () => {
      // What a model did when asked to "open" a site: hand the URL to the desktop, outside the sandbox.
      let asked = 0;
      const output = await run("Start-Process 'https://example.com'", { askHost: async () => (asked++, "approved-once") });
      assert.match(output, /Start-Process/, output);
      assert.equal(asked, 0, "the user was asked about a connection that never happened");
      assert.doesNotMatch(output, /\[pi-outpost\] network/, output);
    });

    // openlore: scenario=NoOneToAskKeepsTheListAlone spec=sandbox-runner-bash
    test("with no one to ask, the list alone decides, and the note names it", { timeout: 120_000 }, async () => {
      const output = await run(status);
      assert.match(output, /\[pi-outpost\] network refused: example\.com — not in sandbox\.allowedHosts\. Ask the user to add it there if the command needs it\.\s*$/, output);
    });

    test("another command's proxy is not a way out", { timeout: 120_000 }, async () => {
      const other = await startEgressProxy({ allowedHosts: ["example.com"] });
      try {
        const port = new URL(other.url).port;
        const output = await run(`'borrowed=' + (curl.exe -s -o NUL -m 10 --ssl-no-revoke -x http://127.0.0.1:${port} -w '%{http_code}' https://example.com/)`, { askHost: async () => "refused" });
        assert.doesNotMatch(output, /borrowed=200/, `a command reached another command's proxy: ${output}`);
      } finally {
        await other.close();
      }
    });
  });

  // openlore: scenario=TheProxyCannotBeBypassed spec=sandbox-runner-bash
  test("TheProxyCannotBeBypassed: no direct connection, and no other service on the host's loopback", { timeout: 120_000 }, async () => {
    relayed.length = 0;
    const result = await ps(
      "'direct=' + (curl.exe -s -o NUL -m 10 --noproxy '*' -w '%{http_code}' https://registry.npmjs.org/) + ' exit=' + $LASTEXITCODE; " +
        `'loopback=' + (curl.exe -s -m 10 --noproxy '*' http://127.0.0.1:${otherPort}/) + ' exit=' + $LASTEXITCODE; ` +
        "try { $c = New-Object Net.Sockets.TcpClient; $c.Connect('140.82.112.3', 443); 'tcp=connected' } catch { 'tcp=refused' }",
    );
    assert.match(result.output, /direct=000 exit=(?!0\b)\d+/, `a direct connection went out: ${result.output}`);
    assert.doesNotMatch(result.output, /other-local-service/, "another service on the host's loopback was reached");
    assert.match(result.output, /loopback= exit=(?!0\b)\d+/, result.output);
    assert.match(result.output, /tcp=refused/, result.output);
    assert.deepEqual(relayed, [], "nothing of it went through the proxy either");
  });
});
