/**
 * The agent's `bash` under macOS' own `sandbox-exec` (Seatbelt), with the profile pi-outpost writes.
 *
 * The MXC twin is `confinedBashMxcMac.test.ts`: the same checks, which the two macOS runners
 * must both pass. Runs where `SEATBELT_EXEC` names `sandbox-exec`, on any Mac — CI's `mxc-macos`
 * job, or `scripts/mxc-macos/test.sh`. Every limit is checked from the command's
 * side: reads and writes beside the root, a signal to a process of the server's user, the
 * server's key, git without the xcrun shim's noise, and the network open or held to
 * `sandbox.allowedHosts`.
 */
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { lookup } from "node:dns/promises";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { confinedBashOperations } from "../src/confinedBash.ts";
import { startEgressProxy, type EgressProxy } from "../src/egressProxy.ts";
import { checkRunner } from "../src/terminalSandbox.ts";

const RUNNER = process.env.SEATBELT_EXEC;
const skip = process.platform !== "darwin" ? "sandbox-exec runs on macOS" : !RUNNER ? "SEATBELT_EXEC is not set (the path of sandbox-exec)" : false;

describe("the agent's bash under Seatbelt (sandbox-exec)", { skip }, () => {
  let base: string;
  let root: string;
  let agentDir: string;
  let holder: ChildProcess;
  const savedKey = process.env.OPENAI_API_KEY;

  before(async () => {
    const check = await checkRunner(RUNNER!);
    assert.ok(check.ok, `Seatbelt cannot confine here: ${check.ok ? "" : check.reason}`);
    base = await mkdtemp(path.join(tmpdir(), "seatbelt-"));
    root = path.join(base, "app");
    agentDir = path.join(base, "agent");
    await mkdir(root);
    await mkdir(agentDir);
    await writeFile(path.join(base, "secret.txt"), "other-secret");
    await writeFile(path.join(agentDir, "auth.json"), '{"key":"sk-agent-secret"}');
    process.env.OPENAI_API_KEY = "sk-server-secret";
    // A process of the server's user, standing for the server: the command must not signal it.
    holder = spawn("sleep", ["600"], { stdio: "ignore" });
  });
  after(async () => {
    holder?.kill();
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

  // openlore: scenario=UnderSeatbeltACommandCannotReachOutsideTheRoot spec=sandbox-runner-bash
  test("UnderSeatbeltACommandCannotReachOutsideTheRoot: reads and writes beside the root fail, the server's user is not signalled, no key", async () => {
    const result = await bash(
      [
        `cat ${base}/secret.txt; echo "sibling=$?"`,
        `cat ${agentDir}/auth.json; echo "agent=$?"`,
        "echo inside > in.txt",
        `echo outside > ${base}/out.txt; echo "beside=$?"`,
        `kill -0 ${holder.pid}; echo "signal=$?"`,
        `kill -TERM ${holder.pid}; echo "term=$?"`,
        "env | grep -c OPENAI_API_KEY",
        "exit 3",
      ].join("\n"),
    );
    assert.equal(result.exitCode, 3, result.output);
    assert.doesNotMatch(result.output, /other-secret|sk-agent-secret/, "something beside the root was read");
    assert.match(result.output, /sibling=1/);
    assert.match(result.output, /agent=1/);
    assert.equal((await readFile(path.join(root, "in.txt"), "utf8")).trim(), "inside");
    assert.match(result.output, /beside=1/, "Seatbelt refuses the write itself");
    await assert.rejects(stat(path.join(base, "out.txt")), "a write landed beside the root");
    assert.match(result.output, /signal=1/, "the command could see the server's user's process");
    assert.match(result.output, /term=1/);
    assert.equal(holder.exitCode, null, "the process was killed");
    assert.equal(holder.signalCode, null, "the process was killed");
    assert.match(result.output, /^0$/m, "OPENAI_API_KEY reached the command");
  });

  // openlore: scenario=GitAppliesTheGlobalIgnoreQuietly spec=terminal
  test("GitAppliesTheGlobalIgnoreQuietly: the global ignore .gitconfig names is applied, quietly, and its folder stays shut", async () => {
    const home = path.join(base, "home");
    const repo = path.join(root, "ignoring");
    await mkdir(home);
    await mkdir(repo);
    await writeFile(path.join(home, ".gitignore_global"), "*.log\n");
    await writeFile(path.join(home, ".gitconfig"), `[user]\n\tname = Me\n\temail = me@example.com\n[core]\n\texcludesfile = ${path.join(home, ".gitignore_global")}\n`);
    await writeFile(path.join(home, "secret.txt"), "home-secret");
    await writeFile(path.join(repo, "debug.log"), "noise");
    await writeFile(path.join(repo, "kept.txt"), "kept");
    const ops = confinedBashOperations({ runner: RUNNER!, root, allowWrite: true, agentDir, gitConfig: path.join(home, ".gitconfig") });
    let output = "";
    const { exitCode } = await ops.exec(`cd ignoring && git init -q . && git status --short; ls ${home}; cat ${home}/secret.txt; echo "secret=$?"`, root, { onData: (data) => (output += data.toString()) });
    assert.equal(exitCode, 0, output);
    assert.doesNotMatch(output, /unable to access|warning/i, "git could not read the global ignore");
    assert.match(output, /\?\? kept\.txt/, output);
    assert.doesNotMatch(output, /debug\.log/, "the global ignore was not applied");
    // The two files are opened, not their folder: nothing else of the home is listed or read.
    assert.doesNotMatch(output, /secret\.txt\s|home-secret/, "the rest of the home folder was reached");
    assert.match(output, /secret=(?!0\b)\d+/, output);
  });

  // openlore: scenario=UnderSeatbeltGitAnswersQuietly spec=sandbox-runner-bash
  test("UnderSeatbeltGitAnswersQuietly: git answers, warns of nothing, and leaves nothing but .git in the root", async () => {
    const repo = path.join(root, "repo");
    await mkdir(repo);
    const before = new Set(await readdir(root));
    const result = await bash("cd repo && git init -q . && git rev-parse --is-inside-work-tree && git status --short --branch");
    assert.equal(result.exitCode, 0, result.output);
    assert.match(result.output, /^true$/m, result.output);
    assert.match(result.output, /^## /m, result.output);
    assert.doesNotMatch(result.output, /warning|error|xcrun|DARWIN_USER/i, "git complained");
    assert.deepEqual(await readdir(repo), [".git"], "git or its shim left something in the repository");
    assert.deepEqual(new Set(await readdir(root)), before, "something appeared in the root (HOME)");
  });

  describe("the network", () => {
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

    // openlore: scenario=UnderSeatbeltAnAllowedHostIsReachedAndOthersAreRefused spec=sandbox-runner-bash
    test("UnderSeatbeltAnAllowedHostIsReachedAndOthersAreRefused: the listed host through the proxy, nothing else", async (t) => {
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
      assert.doesNotMatch(result.output, /other-local-service/, "another service on the loopback was reached");
      assert.match(result.output, /\[pi-outpost\] network refused: example\.com — not in sandbox\.allowedHosts\.[^\n]*\s*$/, result.output);
      assert.ok(relayed.includes("registry.npmjs.org:443"), `not through the proxy: ${relayed.join(", ")}`);
    });

    // openlore: scenario=UnderSeatbeltWithoutAnAllowlistTheNetworkIsOpen spec=sandbox-runner-bash
    test("UnderSeatbeltWithoutAnAllowlistTheNetworkIsOpen: a public host is reached, the loopback is not", async (t) => {
      if (!online) return t.skip("this host does not reach registry.npmjs.org");
      const result = await bash(
        [`echo "open=$(curl -s -o /dev/null -m 20 -w '%{http_code}' https://example.com/)"`, `curl -s -m 5 http://127.0.0.1:${otherPort}/; echo " loopback=$?"`].join("\n"),
      );
      assert.match(result.output, /open=200/, result.output);
      assert.doesNotMatch(result.output, /other-local-service/, "a service on the loopback was reached");
      assert.match(result.output, /loopback=(?!0\b)\d+/, result.output);
    });
  });
});
