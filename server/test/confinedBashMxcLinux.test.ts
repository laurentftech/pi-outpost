/**
 * The agent's `bash` under MXC's real Linux executor (`lxc-exec`, Bubblewrap backend).
 *
 * Runs where `MXC_LXC_EXEC` names the executor, on Linux — in practice the container
 * `scripts/mxc-linux/test.sh` starts. Its two runs say what the host allows:
 * `MXC_LINUX_EXPECT=refused` under Docker's default profile, where the runner must be
 * refused with MXC's reason; `confined` with the documented flags, where every limit is
 * checked from the command's side and the network follows `sandbox.allowedHosts`.
 */
import assert from "node:assert/strict";
import { lookup } from "node:dns/promises";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { confinedBashOperations } from "../src/confinedBash.ts";
import { startEgressProxy, type EgressProxy } from "../src/egressProxy.ts";
import { checkRunner } from "../src/terminalSandbox.ts";

const RUNNER = process.env.MXC_LXC_EXEC;
const EXPECT = process.env.MXC_LINUX_EXPECT;
const skip = process.platform !== "linux" ? "MXC's lxc-exec runs on Linux" : !RUNNER ? "MXC_LXC_EXEC is not set (the path of lxc-exec)" : false;

describe("the agent's bash under MXC on Linux, in a container that refuses it namespaces", { skip: skip || (EXPECT !== "refused" && "MXC_LINUX_EXPECT is not refused") }, () => {
  // openlore: scenario=AContainerWithoutNamespacesRefusesWithTheReason spec=sandbox-runner-bash
  test("AContainerWithoutNamespacesRefusesWithTheReason: the check and every command refuse, naming the namespaces", async () => {
    const check = await checkRunner(RUNNER!);
    assert.ok(!check.ok, "the runner passed its check under Docker's default profile");
    assert.match(check.reason, /namespace/i, check.reason);
    const root = await mkdtemp(path.join(tmpdir(), "mxc-linux-refused-"));
    try {
      const ops = confinedBashOperations({ runner: RUNNER!, root, allowWrite: true });
      await assert.rejects(ops.exec("echo ran > ran.txt", root, { onData: () => {} }), /namespace/i);
      await assert.rejects(stat(path.join(root, "ran.txt")), "the command ran anyway");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("the agent's bash under MXC on Linux", { skip: skip || (EXPECT !== "confined" && "MXC_LINUX_EXPECT is not confined") }, () => {
  let base: string;
  let root: string;
  let agentDir: string;
  const savedKey = process.env.OPENAI_API_KEY;

  before(async () => {
    const check = await checkRunner(RUNNER!);
    assert.ok(check.ok, `MXC cannot confine here: ${check.ok ? "" : check.reason}`);
    base = await mkdtemp(path.join(tmpdir(), "mxc-linux-"));
    root = path.join(base, "app");
    agentDir = path.join(base, "agent");
    await mkdir(root);
    await mkdir(agentDir);
    await writeFile(path.join(base, "secret.txt"), "other-secret");
    await writeFile(path.join(agentDir, "auth.json"), '{"key":"sk-agent-secret"}');
    process.env.OPENAI_API_KEY = "sk-server-secret";
  });
  after(async () => {
    if (savedKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = savedKey;
    if (base) await rm(base, { recursive: true, force: true });
  });

  async function bash(command: string, networkProxy?: EgressProxy) {
    const ops = confinedBashOperations({ runner: RUNNER!, root, allowWrite: true, agentDir, ...(networkProxy ? { networkProxy } : {}) });
    let output = "";
    const { exitCode } = await ops.exec(command, root, { onData: (data) => (output += data.toString()) });
    return { output, exitCode };
  }

  // openlore: scenario=OnLinuxACommandCannotReadOutsideTheRoot spec=sandbox-runner-bash
  test("OnLinuxACommandCannotReadOutsideTheRoot: reads beside the root fail, writes stop at it, no server process or key, git works", async () => {
    const result = await bash(
      [
        `cat ${base}/secret.txt; echo "sibling=$?"`,
        `cat ${agentDir}/auth.json; echo "agent=$?"`,
        "echo inside > in.txt",
        `echo outside > ${base}/out.txt; echo "beside=$?"`,
        // The server is node; the command sees its sandbox's processes only.
        `echo "node-visible=$(grep -lx node /proc/[0-9]*/comm 2>/dev/null | wc -l)"`,
        `echo "key-visible=$(grep -las sk-server-secret /proc/[0-9]*/environ 2>/dev/null | wc -l)"`,
        "env | grep -c OPENAI_API_KEY",
        "git init -q . && git rev-parse --is-inside-work-tree",
        "exit 3",
      ].join("\n"),
    );
    assert.equal(result.exitCode, 3, result.output);
    assert.doesNotMatch(result.output, /other-secret|sk-agent-secret/, "something beside the root was read");
    assert.match(result.output, /sibling=1/);
    assert.match(result.output, /agent=1/);
    assert.equal((await readFile(path.join(root, "in.txt"), "utf8")).trim(), "inside");
    // Bubblewrap builds the command's / on a private tmpfs, with the root's parents created there
    // to mount it on: a write beside the root may succeed in that tmpfs, and vanish with it. What
    // counts is the host.
    assert.match(result.output, /beside=[01]/);
    await assert.rejects(stat(path.join(base, "out.txt")), "a write landed beside the root");
    assert.match(result.output, /node-visible=0/, "the server's process is visible to the command");
    assert.match(result.output, /key-visible=0/, "a process holding the server's key is visible to the command");
    assert.match(result.output, /^0$/m, "OPENAI_API_KEY reached the command");
    assert.match(result.output, /^true$/m, "git did not run in the root");
  });

  describe("the network under sandbox.allowedHosts", () => {
    let proxy: EgressProxy;
    let other: Server;
    let otherPort: number;
    const relayed: string[] = [];
    let online = false;

    before(async () => {
      online = await lookup("registry.npmjs.org").then(() => true, () => false);
      proxy = await startEgressProxy({ allowedHosts: ["registry.npmjs.org"], onRefused: () => {}, onRelayed: (target) => relayed.push(target) });
      other = createServer((_req, res) => res.end("other-local-service"));
      await new Promise<void>((resolve) => other.listen(0, "127.0.0.1", resolve));
      otherPort = (other.address() as { port: number }).port;
    });
    after(async () => {
      await proxy?.close();
      await new Promise((resolve) => (other ? other.close(resolve) : resolve(undefined)));
    });

    // openlore: scenario=OnLinuxAnAllowedHostIsReachedAndOthersAreRefused spec=sandbox-runner-bash
    test("OnLinuxAnAllowedHostIsReachedAndOthersAreRefused: the listed host through the proxy, nothing else", async (t) => {
      if (!online) return t.skip("this host does not reach registry.npmjs.org");
      const result = await bash(
        [
          `echo "allowed=$(curl -s -o /dev/null -m 20 -w '%{http_code}' https://registry.npmjs.org/)"`,
          `curl -sS -o /dev/null -m 20 https://example.com/; echo "unlisted=$?"`,
          `curl -s -o /dev/null -m 10 --noproxy '*' https://registry.npmjs.org/; echo "direct=$?"`,
          `curl -s -m 10 --noproxy '*' http://127.0.0.1:${otherPort}/; echo " loopback=$?"`,
        ].join("\n"),
        proxy,
      );
      assert.match(result.output, /allowed=200/, result.output);
      assert.match(result.output, /unlisted=(?!0\b)\d+/, result.output);
      assert.match(result.output, /direct=(?!0\b)\d+/, `a direct connection went out: ${result.output}`);
      assert.doesNotMatch(result.output, /other-local-service/, "another service on the container's loopback was reached");
      assert.match(result.output, /\[pi-outpost\] network refused: example\.com — not in sandbox\.allowedHosts\.[^\n]*\s*$/, result.output);
      assert.ok(relayed.includes("registry.npmjs.org:443"), `not through the proxy: ${relayed.join(", ")}`);
    });

    test("without allowedHosts the network is open", async (t) => {
      if (!online) return t.skip("this host does not reach registry.npmjs.org");
      const result = await bash(`echo "open=$(curl -s -o /dev/null -m 20 -w '%{http_code}' https://example.com/)"`);
      assert.match(result.output, /open=200/, result.output);
    });
  });
});
