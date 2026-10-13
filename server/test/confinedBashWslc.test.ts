/**
 * The agent's `bash` in a Linux container, through MXC's WSLC backend (`sandbox.bashImage`).
 *
 * The request pi-outpost hands MXC is checked everywhere. The command's side — a real bash,
 * git, writes landing on the host, nothing else of the host visible, a turn's parallel calls
 * all served — only where `MXC_EXEC` names the executor and `MXC_WSLC_IMAGE` an image with
 * bash and git (`buildpack-deps:bookworm-scm`): no CI runner has WSL containers.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { confinedBashOperations, mxcWslcConfig, oneWslcAtATime, wslcPath } from "../src/confinedBash.ts";

describe("a WSLC request", () => {
  const root = "C:\\work\\app";
  const tmp = "C:\\Users\\me\\AppData\\Local\\Temp\\pi-outpost-bash-x1";
  const script = `${tmp}\\command.sh`;

  test("a Windows path is where WSLC mounts it", () => {
    assert.equal(wslcPath("C:\\work\\app"), "/mnt/c/work/app");
    assert.equal(wslcPath("D:/data/My Project/x.sh"), "/mnt/d/data/My Project/x.sh");
    assert.equal(wslcPath("C:\\"), "/mnt/c");
  });

  // openlore: scenario=AWslcCommandRunsInTheImage spec=sandbox-runner-bash
  test("AWslcCommandRunsInTheImage: the image, bash on the script, the root and the command's folder mounted, nothing of the server", () => {
    const saved = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "sk-server-secret";
    try {
      const request = mxcWslcConfig({ image: "buildpack-deps:bookworm-scm", root, allowWrite: true, tmp, script, cwd: `${root}\\src` });
      assert.equal(request.containment, "wslc");
      assert.equal(request.wslc.image, "buildpack-deps:bookworm-scm");
      assert.equal(request.process.commandLine, "/bin/bash /mnt/c/Users/me/AppData/Local/Temp/pi-outpost-bash-x1/command.sh");
      assert.equal(request.process.cwd, `${root}\\src`);
      assert.deepEqual(request.filesystem, { readwritePaths: [root, tmp], readonlyPaths: [] });
      assert.doesNotMatch(JSON.stringify(request), /sk-server-secret|OPENAI_API_KEY/, "the container's environment is its own");
      // One image store for every command: under the command's folder it would be pulled each time.
      assert.equal(path.basename(request.wslc.storagePath), "mxc-wslc-sessions");
      assert.ok(!request.wslc.storagePath.includes("pi-outpost-bash-"));
    } finally {
      if (saved === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = saved;
    }
  });

  test("each run is a container of its own, with a name WSLC accepts", () => {
    const names = new Set(
      Array.from({ length: 20 }, () => mxcWslcConfig({ image: "img", root, allowWrite: false, tmp, script, cwd: root }).containerId),
    );
    assert.equal(names.size, 20);
    for (const name of names) assert.match(name, /^[a-z0-9]+$/, "without a name of its own MXC picks `CLI`, which WSLC refuses");
  });

  test("without write, the root is mounted read-only", () => {
    const request = mxcWslcConfig({ image: "img", root, allowWrite: false, tmp, script, cwd: root });
    assert.deepEqual(request.filesystem, { readwritePaths: [tmp], readonlyPaths: [root] });
  });

  // openlore: scenario=AWritableZoneInsideTheRootIsRefusedUnderWslc spec=sandbox-runner-bash
  test("AWritableZoneInsideTheRootIsRefusedUnderWslc: the command is refused with the reason, not run more open", () => {
    assert.throws(
      () => mxcWslcConfig({ image: "img", root, writableRoot: `${root}\\out`, allowWrite: true, tmp, script, cwd: root }),
      /writableRoot/,
    );
    assert.doesNotThrow(() => mxcWslcConfig({ image: "img", root, writableRoot: root, allowWrite: true, tmp, script, cwd: root }));
  });

  // openlore: scenario=WslcRunsOneAtATime spec=sandbox-runner-bash
  test("WslcRunsOneAtATime: a turn's parallel calls never overlap, and a failure does not stop the next", async () => {
    let running = 0;
    let most = 0;
    const order: number[] = [];
    const launch = (n: number, fail = false) => async () => {
      running++;
      most = Math.max(most, running);
      await new Promise((resolve) => setTimeout(resolve, 20));
      running--;
      order.push(n);
      if (fail) throw new Error(`run ${n} failed`);
      return n;
    };
    const results = await Promise.allSettled([oneWslcAtATime(launch(1)), oneWslcAtATime(launch(2, true)), oneWslcAtATime(launch(3))]);
    assert.equal(most, 1);
    assert.deepEqual(order, [1, 2, 3]);
    assert.deepEqual(results.map((r) => r.status), ["fulfilled", "rejected", "fulfilled"]);
  });
});

const RUNNER = process.env.MXC_EXEC;
const IMAGE = process.env.MXC_WSLC_IMAGE;
const skip =
  process.platform !== "win32" ? "WSLC runs on Windows only" : !RUNNER || !IMAGE ? "MXC_EXEC and MXC_WSLC_IMAGE are not both set" : false;

describe("the agent's bash in a WSLC container, under MXC's real executor", { skip }, () => {
  let base: string;
  let root: string;
  const savedKey = process.env.OPENAI_API_KEY;

  before(async () => {
    base = await mkdtemp(path.join(tmpdir(), "confined-bash-wslc-"));
    root = path.join(base, "app");
    await mkdir(path.join(root, "out"), { recursive: true });
    await writeFile(path.join(base, "secret.txt"), "other-secret");
    execFileSync("git", ["init", "-q", root]);
    process.env.OPENAI_API_KEY = "sk-server-secret";
  });
  after(async () => {
    if (savedKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = savedKey;
    if (base) await rm(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });

  async function bash(command: string) {
    const ops = confinedBashOperations({ runner: RUNNER!, image: IMAGE!, root, allowWrite: true });
    let output = "";
    const { exitCode } = await ops.exec(command, root, { onData: (data) => (output += data.toString()) });
    return { output, exitCode };
  }

  test("a real bash with git; writes land on the host; the exit status comes back", { timeout: 600_000 }, async () => {
    const result = await bash("echo \"$BASH_VERSION\"; git rev-parse --is-inside-work-tree; echo inside > out/a.txt; exit 3");
    assert.equal(result.exitCode, 3, result.output);
    assert.match(result.output, /^\d+\.\d+/m);
    assert.match(result.output, /^true$/m);
    assert.equal((await readFile(path.join(root, "out", "a.txt"), "utf8")).trim(), "inside");
  });

  test("nothing beside the root exists inside, and no key of the server", { timeout: 600_000 }, async () => {
    const result = await bash("cat ../secret.txt; env");
    assert.doesNotMatch(result.output, /other-secret|sk-server-secret|OPENAI_API_KEY/);
  });

  test("a turn's parallel calls are all served", { timeout: 600_000 }, async () => {
    const results = await Promise.all([1, 2, 3].map((n) => bash(`echo run-${n}`)));
    results.forEach((result, i) => {
      assert.equal(result.exitCode, 0, result.output);
      assert.match(result.output, new RegExp(`run-${i + 1}`));
    });
  });
});
